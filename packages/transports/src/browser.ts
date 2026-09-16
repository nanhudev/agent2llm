/**
 * Browser transport — the boundary that C2C left inside Codex.
 *
 * In Agent2LLM no Harness adapter is allowed to own a browser. Web Brains
 * (ChatGPT, Claude) need one, so the transport is a first-class Core service.
 *
 * Hard rules enforced by contract, not by convention:
 *   - official website UI automation only
 *   - no reverse proxy, no private API interception
 *   - no cookie export, no token scraping, no profile upload
 *   - CAPTCHA / 2FA / security confirmations are surfaced as
 *     USER_ACTION_REQUIRED and never automated around
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export interface BrowserSelectors {
  /** Input box the adapter types the control message into. */
  composer: string;
  /** Container for the latest assistant message. */
  assistantMessage: string;
  /** Presence means "still generating". */
  streaming?: string;
  /** Presence means a human must do something (login, CAPTCHA, ...). */
  challenge?: string;
}

export interface BrowserLaunchOptions {
  /** Persistent context directory; user logs in once, through the real UI. */
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  /** Opt-in debug screenshots. Never enabled by default. */
  captureScreenshots?: boolean;
  /**
   * DevTools endpoint of an already-running Chromium window, e.g.
   * `http://127.0.0.1:9222`. Setting this selects the attach path.
   */
  endpoint?: string;
  /**
   * Site the session is meant to use. When attaching, a tab already showing
   * this host is reused instead of opening a new one.
   */
  targetUrl?: string;
}

export interface BrowserPageState {
  url: string;
  loggedIn: boolean;
  challenge: boolean;
  streaming: boolean;
  lastAssistantMessage: string;
  /** How many assistant messages are on screen; used to spot a *new* reply. */
  messageCount: number;
}

export interface BrowserTransport {
  readonly kind: string;
  launch(options?: BrowserLaunchOptions): Promise<void>;
  open(url: string): Promise<void>;
  state(): Promise<BrowserPageState>;
  type(text: string): Promise<void>;
  submit(): Promise<void>;
  /** Wait until the assistant message changes and generation stops. */
  waitForReply(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserCapabilityProbe {
  installed: boolean;
  kind: string;
  reason?: string;
}

/**
 * Detects whether a browser automation backend is available *without*
 * importing it. Playwright is an optional peer dependency: Agent2LLM must
 * install and run fine without it, simply reporting the Brain as
 * `implemented / detected:false`.
 *
 * `createRequire` is not optional here. This package ships as ESM, where the
 * bare `require` binding does not exist: calling `require.resolve` directly
 * threw a ReferenceError that this try/catch swallowed, so the probe answered
 * `installed:false` even with Playwright fully installed — and every Web Brain
 * silently fell back to the manual transport.
 */
const requireFromTransports = createRequire(import.meta.url);

export function probeBrowserModule(moduleName = "playwright"): BrowserCapabilityProbe {
  try {
    requireFromTransports.resolve(moduleName);
    return { installed: true, kind: moduleName };
  } catch (error) {
    return {
      installed: false,
      kind: moduleName,
      reason: `${moduleName} is not installed. Web Brain automation is unavailable; the manual transport still works.`,
    };
  }
}

export interface EndpointProbe {
  reachable: boolean;
  endpoint: string;
  /** The `Browser` field of /json/version, e.g. "Edg/153.0.4234.32". */
  browser?: string;
  protocolVersion?: string;
  reason?: string;
}

/**
 * Is a DevTools endpoint live, and what is behind it?
 *
 * Attaching is only ever attempted against an endpoint that answered here.
 * An open TCP port is not enough evidence: an unrelated process can hold a
 * socket. We want `/json/version` to name the engine, so a failure to attach
 * is a real protocol problem rather than "something else was listening".
 */
export async function probeChromiumEndpoint(
  endpoint: string,
  options: { timeoutMs?: number } = {}
): Promise<EndpointProbe> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const base = endpoint.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/json/version`, { signal: controller.signal });
    if (!res.ok) return { reachable: false, endpoint: base, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { Browser?: string; "Protocol-Version"?: string };
    return {
      reachable: true,
      endpoint: base,
      browser: body.Browser,
      protocolVersion: body["Protocol-Version"],
    };
  } catch (error) {
    return {
      reachable: false,
      endpoint: base,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Process-wide default attach endpoint. A CLI flag sets this before a session
 * is built, which is how `--endpoint` reaches a Brain without threading a
 * browser detail through the protocol layer.
 */
export const ATTACH_ENDPOINT_ENV = "AGENT2LLM_ATTACH_ENDPOINT";

/** Ports a Chromium application is commonly told to listen on. */
export const DEFAULT_DEVTOOLS_PORTS = [9222, 9223, 9229];

export interface AttachEndpoint {
  endpoint: string;
  browser?: string;
}

/**
 * Probe answers are cached for a moment.
 *
 * `detect` asks several adapters about the same ports at once, and each of
 * those questions is a network round trip on a tight timeout. Without a cache
 * the answers race: one probe wins the connection, another exceeds the
 * timeout, and two adapters disagree about the same window. One probe, one
 * answer, shared.
 */
const probeCache = new Map<string, { at: number; result: AttachEndpoint | null }>();
const PROBE_CACHE_TTL_MS = 1000;

/** Drop cached probe answers. Tests need a deterministic first look. */
export function resetAttachProbeCache(): void {
  probeCache.clear();
}

/** A single named endpoint, or null if nothing answered there. */
export async function probeAttachEndpoint(
  endpoint: string,
  options: { timeoutMs?: number } = {}
): Promise<AttachEndpoint | null> {
  const key = endpoint.replace(/\/+$/, "");
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS) return cached.result;

  const probe = await probeChromiumEndpoint(key, { timeoutMs: options.timeoutMs ?? 800 });
  const result: AttachEndpoint | null = probe.reachable
    ? { endpoint: probe.endpoint, ...(probe.browser ? { browser: probe.browser } : {}) }
    : null;
  probeCache.set(key, { at: Date.now(), result });
  return result;
}

/* ------------------------------------------------------------------ *
 * Profiles that name their own port
 *
 * A window started with `--remote-debugging-port=9222` can be found by
 * guessing the port. A WebView2 host — which is what the packaged desktop
 * builds are — often cannot: the engine may bind an arbitrary port and record
 * it in a profile file instead. So before sweeping ports we read the file
 * Chromium writes for exactly this purpose.
 * ------------------------------------------------------------------ */

/** Chromium writes this into its user-data directory when it starts listening. */
export const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";

/** WebView2 hosts read this to hand extra flags to the engine at startup. */
export const WEBVIEW2_ARGS_ENV = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

/**
 * Where a WebView2 host keeps its profile, relative to the app's data root.
 * A packaged (MSIX / Microsoft Store) app is redirected under `Packages\<id>`,
 * so the same file can sit at several depths depending on how the host asked
 * for its user data directory.
 */
const WEBVIEW2_PROFILE_SUBPATHS: readonly (readonly string[])[] = [
  ["EBWebView"],
  ["LocalCache", "EBWebView"],
  ["LocalCache", "Local", "EBWebView"],
  ["LocalCache", "Roaming", "EBWebView"],
  ["LocalState", "EBWebView"],
];

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    // Missing or unreadable: absence of evidence, which is not a failure.
    return [];
  }
}

export interface ProfileSearchOptions {
  /** Data root to search. Defaults to the platform's app data directory. */
  root?: string;
  /** Directory names worth looking into. */
  match?: RegExp;
}

/**
 * Candidate `DevToolsActivePort` files, whether or not they exist.
 *
 * One level below the data root is enumerated rather than assumed: installers
 * and Store package names change between releases, so a hardcoded path list
 * goes stale, while a listing plus a name filter does not.
 *
 * `root` is injectable so a test can point this at a fixture directory instead
 * of the real profile store.
 */
export function devToolsActivePortPaths(options: ProfileSearchOptions = {}): string[] {
  const root =
    options.root ?? (process.platform === "win32" ? process.env.LOCALAPPDATA ?? "" : "");
  if (root === "") return [];
  const match = options.match ?? /chatgpt|openai/i;

  const out: string[] = [];
  const push = (candidate: string) => {
    if (!out.includes(candidate)) out.push(candidate);
  };

  for (const entry of safeReaddir(root)) {
    if (!match.test(entry)) continue;
    for (const sub of WEBVIEW2_PROFILE_SUBPATHS) {
      push(path.join(root, entry, ...sub, DEVTOOLS_ACTIVE_PORT_FILE));
    }
  }

  const packages = path.join(root, "Packages");
  for (const entry of safeReaddir(packages)) {
    if (!match.test(entry)) continue;
    for (const sub of WEBVIEW2_PROFILE_SUBPATHS) {
      push(path.join(packages, entry, ...sub, DEVTOOLS_ACTIVE_PORT_FILE));
    }
  }
  return out;
}

/** The subset of candidates that is actually on disk. */
export function existingDevToolsActivePortFiles(options: ProfileSearchOptions = {}): string[] {
  return devToolsActivePortPaths(options).filter((file) => fs.existsSync(file));
}

/**
 * Read the port an engine actually bound.
 *
 * Line one is the port, line two is the browser WebSocket path. Only the port
 * is used: the HTTP endpoint derived from it answers `/json/version` the same
 * way a window launched with an explicit flag does, and `connectOverCDP` takes
 * either form.
 *
 * A stale file left behind by an exited process is not reported as an error.
 * The endpoint derived from it simply fails to answer, which is the same
 * outcome as no file at all — and the caller already treats that as normal.
 */
export function readDevToolsActivePort(file: string): AttachEndpoint | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const first = raw.split(/\r?\n/)[0]?.trim() ?? "";
  const port = Number.parseInt(first, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { endpoint: `http://127.0.0.1:${port}` };
}

/** Endpoints named by profile files, deduplicated, in discovery order. */
export function discoverAttachEndpoints(options: ProfileSearchOptions = {}): string[] {
  const out: string[] = [];
  for (const file of devToolsActivePortPaths(options)) {
    const found = readDevToolsActivePort(file);
    if (found && !out.includes(found.endpoint)) out.push(found.endpoint);
  }
  return out;
}

export interface FindAttachEndpointOptions extends ProfileSearchOptions {
  ports?: number[];
  timeoutMs?: number;
  /** Skip profile discovery and try exactly these endpoints. */
  extraEndpoints?: string[];
}

/**
 * First DevTools endpoint that answers, if any.
 *
 * Profile-named endpoints are tried before the conventional ports: a port an
 * engine recorded itself is evidence, a port we guessed is a hunch.
 *
 * Shared by transport selection, the desktop-app probe and `doctor`, so all
 * three agree on what "attachable" means instead of each sweeping their own
 * way.
 */
export async function findAttachEndpoint(
  options: FindAttachEndpointOptions = {}
): Promise<AttachEndpoint | null> {
  const timeoutMs = options.timeoutMs ?? 800;

  const discovered =
    options.extraEndpoints ??
    discoverAttachEndpoints({
      ...(options.root !== undefined ? { root: options.root } : {}),
      ...(options.match !== undefined ? { match: options.match } : {}),
    });

  for (const endpoint of discovered) {
    const hit = await probeAttachEndpoint(endpoint, { timeoutMs });
    if (hit) return hit;
  }

  const ports = options.ports ?? DEFAULT_DEVTOOLS_PORTS;
  for (const port of ports) {
    const hit = await probeAttachEndpoint(`http://127.0.0.1:${port}`, { timeoutMs });
    if (hit) return hit;
  }
  return null;
}
