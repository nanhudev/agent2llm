/**
 * Profile discovery: finding a window that never announced its port.
 *
 * Split out of `browser.ts` because it is a self-contained question — which
 * directories might name a port, and which of those belong to a live process —
 * with its own rules that have nothing to do with driving a page.
 */
import { execFileSync as childProcessExec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AttachEndpoint } from "./browser.js";

export interface ProfileSearchOptions {
  /** Data root to search. Defaults to the platform's app data directory. */
  root?: string;
  /** Directory names worth looking into. */
  match?: RegExp;
  /**
   * Only accept a profile whose owning process is currently running.
   *
   * The app data root is shared, so it holds leftovers from other programs and
   * from uninstalls. A `DevToolsActivePort` sitting in one of those describes a
   * process that no longer exists, and reporting it as "the app's profile"
   * sends the reader to the wrong place.
   */
  liveProcess?: string;
}

/** Chromium writes this into its user-data directory when it starts listening. */
export const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";

/** WebView2 hosts read this to hand extra flags to the engine at startup. */
export const WEBVIEW2_ARGS_ENV = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

/**
 * Where a host keeps its browser profile, relative to the app's data root.
 *
 * A packaged (MSIX / Microsoft Store) app is redirected under `Packages\<id>`,
 * so the same file can sit at several depths depending on how the host asked
 * for its user data directory. Both shapes are covered:
 *
 *   WebView2 host:      <root>\EBWebView\DevToolsActivePort
 *   plain Chromium:     <root>\DevToolsActivePort
 *   Chromium in a pkg:  <root>\web\Codex\DevToolsActivePort
 *
 * `EBWebView` is the directory WebView2 appends automatically; a host that
 * embeds a full Chromium instead keeps an ordinary Chromium layout.
 */
const PROFILE_SUBPATHS: readonly (readonly string[])[] = [
  [],
  ["EBWebView"],
  ["LocalCache", "EBWebView"],
  ["LocalCache", "Local", "EBWebView"],
  ["LocalCache", "Roaming", "EBWebView"],
  ["LocalState", "EBWebView"],
  // A packaged Chromium app: <Package>\LocalCache\Roaming\<App>\web\<App>\
  ["LocalCache", "Roaming", "Codex", "web", "Codex"],
  ["LocalCache", "Local", "Codex", "web", "Codex"],
  ["Roaming", "Codex", "web", "Codex"],
];

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    // Missing or unreadable: absence of evidence, which is not a failure.
    return [];
  }
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
    for (const sub of PROFILE_SUBPATHS) {
      push(path.join(root, entry, ...sub, DEVTOOLS_ACTIVE_PORT_FILE));
    }
  }

  const packages = path.join(root, "Packages");
  for (const entry of safeReaddir(packages)) {
    if (!match.test(entry)) continue;
    for (const sub of PROFILE_SUBPATHS) {
      push(path.join(packages, entry, ...sub, DEVTOOLS_ACTIVE_PORT_FILE));
    }
  }
  return out;
}

/**
 * Is a process with this image name running?
 *
 * `null` means the question could not be answered, which callers must treat as
 * "do not filter" rather than "not running" — a machine where the process list
 * is unavailable should still get profile discovery.
 */
function processIsRunning(imageName: string): boolean | null {
  try {
    if (process.platform !== "win32") {
      const out = childProcessExec("ps", ["-A", "-o", "comm="], { timeout: 5000, encoding: "utf8" });
      return out.toLowerCase().includes(imageName.replace(/\.exe$/i, "").toLowerCase());
    }
    const out = childProcessExec("tasklist", ["/FO", "CSV", "/NH"], {
      timeout: 5000,
      encoding: "utf8",
      windowsHide: true,
    });
    return out.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return null;
  }
}

/** The subset of candidates that is actually on disk. */
export function existingDevToolsActivePortFiles(options: ProfileSearchOptions = {}): string[] {
  const files = devToolsActivePortPaths(options).filter((file) => fs.existsSync(file));
  if (options.liveProcess === undefined) return files;

  const live = processIsRunning(options.liveProcess);
  // Undeterminable is not a reason to discard evidence.
  if (live === null) return files;
  return live ? files : [];
}

/**
 * Profiles that a process is currently holding.
 *
 * A Chromium engine writes `lockfile` beside its port file while it is running
 * and removes it on a clean exit. So a directory with a lockfile belongs to a
 * live process, and a `DevToolsActivePort` sitting in a directory *without* one
 * was left behind. Distinguishing the two matters when both are on disk under a
 * name that matches: reporting the leftover sends the reader to a directory
 * their application is not using.
 */
export function heldProfiles(options: ProfileSearchOptions = {}): string[] {
  return devToolsActivePortPaths(options).filter(
    (file) => fs.existsSync(file) || fs.existsSync(path.join(path.dirname(file), "lockfile"))
  );
}

/**
 * Directories that hold a port file but no lockfile: stale leftovers.
 *
 * Listed rather than silently dropped, because a user who hand-launched
 * something with `--user-data-dir` earlier deserves to be told why the path
 * they recognise is not the one being used.
 */
export function staleProfilePortFiles(options: ProfileSearchOptions = {}): string[] {
  return devToolsActivePortPaths(options).filter((file) => {
    if (!fs.existsSync(file)) return false;
    return !fs.existsSync(path.join(path.dirname(file), "lockfile"));
  });
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

/**
 * Endpoints named by profile files, deduplicated, in discovery order.
 *
 * Files only: an endpoint that names a process which is not running is still
 * listed here, because the caller probes it anyway and a dead port costs one
 * refused connection. `existingDevToolsActivePortFiles` is the narrower view,
 * for callers that report a profile to a human.
 */
export function discoverAttachEndpoints(options: ProfileSearchOptions = {}): string[] {
  const out: string[] = [];
  for (const file of devToolsActivePortPaths(options)) {
    const found = readDevToolsActivePort(file);
    if (found && !out.includes(found.endpoint)) out.push(found.endpoint);
  }
  return out;
}

