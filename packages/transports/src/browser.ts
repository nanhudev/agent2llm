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
import { ATTACH_PORTS_ENV, discoverAttachEndpoints } from "./profile.js";
import type { ProfileSearchOptions } from "./profile.js";

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
 *
 * The base URL is wrapped in try/catch because the SEA executable bundles
 * this file as CommonJS, where esbuild empties `import.meta` and
 * `createRequire(undefined)` would throw at module load — taking the whole
 * CLI down before a single command runs. Falling back to the executable
 * itself means resolving playwright from there can only fail, so the probe
 * answers `installed:false`, which is exactly what an executable without
 * node_modules should report (the CDP attach path needs no playwright and
 * keeps working).
 */
const requireFromTransports: NodeRequire = (() => {
  try {
    return createRequire(import.meta.url);
  } catch {
    return createRequire(process.execPath);
  }
})();

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

// Profile discovery lives in ./profile.ts; re-exported so callers keep one import.
export * from "./profile.js";

export interface FindAttachEndpointOptions extends ProfileSearchOptions {
  ports?: number[];
  timeoutMs?: number;
  /** Skip profile discovery and try exactly these endpoints. */
  extraEndpoints?: string[];
  /**
   * Honour `AGENT2LLM_ATTACH_ENDPOINT` / `--endpoint` before anything else.
   *
   * `selectTransport` always took the explicit endpoint seriously, but the
   * read-only callers (`doctor`, the desktop-app probe) called this with no
   * arguments and swept only the conventional ports. So a user who pointed the
   * CLI at a window by hand was still told "no DevTools endpoint answered" —
   * the one piece of evidence they had supplied was the one piece ignored.
   */
  explicitEndpoint?: string;
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

  // An endpoint the user named outranks every heuristic: it is a statement of
  // fact ("the window is here"), not a guess about where one might be.
  const explicit = options.explicitEndpoint?.trim() ?? process.env[ATTACH_ENDPOINT_ENV]?.trim() ?? "";
  if (explicit !== "") {
    return probeAttachEndpoint(explicit, { timeoutMs });
  }

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

/**
 * Where the attach answer came from, or would have come from.
 *
 * `findAttachEndpoint` collapses three quite different situations into one
 * `null`: nobody told us where to look, we looked in the places we know and
 * nothing answered, or the user named an endpoint and it was dead. Those need
 * three different repairs, so the reason is reported instead of inferred.
 */
export type AttachSource =
  | { kind: "explicit"; endpoint: string }
  | { kind: "profile"; endpoints: string[] }
  | { kind: "ports"; ports: number[] };

export function attachEndpointSource(options: FindAttachEndpointOptions = {}): AttachSource {
  const explicit = options.explicitEndpoint?.trim() ?? process.env[ATTACH_ENDPOINT_ENV]?.trim() ?? "";
  if (explicit !== "") return { kind: "explicit", endpoint: explicit };

  const extra = options.extraEndpoints;
  if (extra && extra.length > 0) return { kind: "profile", endpoints: extra };

  const fromProfiles = discoverAttachEndpoints({
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.match !== undefined ? { match: options.match } : {}),
  });
  if (fromProfiles.length > 0) return { kind: "profile", endpoints: fromProfiles };

  return { kind: "ports", ports: options.ports ?? DEFAULT_DEVTOOLS_PORTS };
}

/** The repair line for a failed attach, chosen by where we looked. */
export function attachRepairHint(source: AttachSource): string {
  switch (source.kind) {
    case "explicit":
      return (
        `Nothing answered at ${source.endpoint}. Check the window is still open and that its port ` +
        "matches, then re-run. Drop the endpoint to let Agent2LLM find a window itself."
      );
    case "profile":
      return (
        `A window profile names ${source.endpoints.join(", ")}, but nothing answered there. ` +
        "The process that wrote it has exited — start that app again."
      );
    case "ports":
      return (
        `Nothing answered on ${source.ports.join(", ")}. Start a Chromium window with a debug port ` +
        "— msedge --remote-debugging-port=9222 — or name the port you used with " +
        `--endpoint http://127.0.0.1:<port> (or ${ATTACH_PORTS_ENV}=<port>).`
      );
  }
}

