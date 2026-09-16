/**
 * Desktop application sensing.
 *
 * A desktop build is a better Brain host than a browser we launch: the user is
 * already signed in, the window outlives the CLI process, and nothing about it
 * looks like automation. So it is worth knowing whether one is present.
 *
 * What this module deliberately does NOT do is claim a given build exposes a
 * DevTools port. Some do, some ship with the flag turned off, and the only
 * honest answer comes from trying. So `endpoint` is set only to a port that
 * actually answered, and everything else is reported as the observations it
 * is: a path on disk, and whether a process is running.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WEBVIEW2_ARGS_ENV,
  heldProfiles,
  findAttachEndpoint,
  resetAttachProbeCache,
  staleProfilePortFiles,
} from "./browser.js";

export { resetAttachProbeCache };

/**
 * The desktop build's own profile directories, as opposed to unrelated ones.
 *
 * `codex` is not optional here. The package's identity is `OpenAI.Codex` and it
 * keeps its browser profile under a directory called `Codex`, so a pattern
 * built only from the product name misses the app's real profile and can still
 * match an unrelated leftover directory named `ChatGPT`.
 */
const DESKTOP_PROFILE_MATCH = /chatgpt|codex|openai/i;

export interface DesktopAppProbe {
  id: string;
  displayName: string;
  /** An executable was found on disk. */
  installed: boolean;
  /** Where it was found. Empty when nothing matched. */
  executables: string[];
  /** `null` means "could not determine", which is not the same as "no". */
  running: boolean | null;
  /** A DevTools endpoint that answered a request. Never guessed. */
  endpoint?: string;
  /** What `/json/version` said was behind that endpoint. */
  endpointBrowser?: string;
  /**
   * Profile files that name a port, whether or not anything is listening.
   * A file with nothing behind it means the app is installed but not running —
   * a different situation from "this build cannot be attached to".
   */
  profileFiles: string[];
  /** Plain-language next step, phrased for a person, not a log file. */
  hint: string;
}

/**
 * What the official build actually is, on each platform.
 *
 * Two names, one product. OpenAI ships the desktop app as an MSIX package whose
 * internal identity is `OpenAI.Codex` while its Start-menu name — and its
 * executable — is `ChatGPT`. A probe that only looks under `ChatGPT` misses it
 * entirely, which is exactly what happened the first time this was written.
 *
 * The package also declares itself as an ordinary Chromium: the running
 * processes carry `--type=renderer` and `--user-data-dir`, and its profile
 * holds `Local State` and `lockfile`. So `--remote-debugging-port` belongs on
 * this executable's own command line — it is not a WebView2 host, and nothing
 * has to be forwarded through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.
 */
const DESKTOP_APP_IDS = ["ChatGPT", "Codex", "OpenAI"] as const;

/** Directory names that may hold an install of the official build. */
const DESKTOP_APP_DIR_HINTS = /chatgpt|codex|openai/i;

/**
 * Read a directory, or report nothing.
 *
 * Several of the roots probed here are legitimately unreadable — `WindowsApps`
 * in particular denies listing the *contents* of a package directory — and an
 * unreadable directory is absence of evidence, not evidence of absence.
 */
function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Standard install locations for the official desktop build. */
export function desktopAppSearchPaths(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const pf = process.env.ProgramFiles ?? "";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "";
    const out: string[] = [];
    for (const name of DESKTOP_APP_IDS) {
      out.push(
        path.join(local, "Programs", name, `${name}.exe`),
        path.join(local, name, `${name}.exe`),
        path.join(pf, name, `${name}.exe`),
        path.join(pf86, name, `${name}.exe`)
      );
      // A WindowsApps alias is a zero-byte reparse point and cannot be
      // executed with arguments, but it still proves the package exists.
      out.push(path.join(local, "Microsoft", "WindowsApps", `${name}.exe`));
    }
    return out;
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      path.join(os.homedir(), "Applications", "ChatGPT.app", "Contents", "MacOS", "ChatGPT"),
    ];
  }
  return [];
}

/**
 * Executables inside installed MSIX packages.
 *
 * `%ProgramFiles%\WindowsApps` is readable for *listing package directories*
 * even though it is not readable for listing the files inside an app folder,
 * and the executable always sits at `<package>\app\<Name>.exe`. That makes the
 * real path reachable without elevation — and reachable is what matters, since
 * an alias under `WindowsApps` silently ignores the arguments we pass.
 *
 * Package names carry a version and a hash (`OpenAI.Codex_26.908.9136.0_x64__…`),
 * so they are enumerated rather than constructed.
 */
export function scanWindowsAppsPackages(): string[] {
  if (process.platform !== "win32") return [];
  const root = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "WindowsApps");
  const found: string[] = [];
  for (const entry of safeReaddir(root)) {
    if (!DESKTOP_APP_DIR_HINTS.test(entry)) continue;
    for (const name of DESKTOP_APP_IDS) {
      const candidate = path.join(root, entry, "app", `${name}.exe`);
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

/**
 * Sweep the usual install roots for a desktop-build directory. Installers move
 * things around between releases, so a fixed path list alone goes stale.
 *
 * `WindowsApps` is deliberately not part of this sweep; `scanWindowsAppsPackages`
 * handles it, because its layout is a package directory one level deeper than
 * an ordinary install and a plain join would miss it.
 */
export function scanForDesktopApp(): string[] {
  const roots =
    process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA ?? "", "Programs"),
          process.env.ProgramFiles ?? "",
          process.env["ProgramFiles(x86)"] ?? "",
        ]
      : process.platform === "darwin"
        ? ["/Applications", path.join(os.homedir(), "Applications")]
        : [];

  const found: string[] = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of safeReaddir(root)) {
      if (!DESKTOP_APP_DIR_HINTS.test(entry)) continue;
      for (const name of DESKTOP_APP_IDS) {
        const candidate =
          process.platform === "darwin"
            ? path.join(root, entry, "Contents", "MacOS", "ChatGPT")
            : path.join(root, entry, `${name}.exe`);
        if (fs.existsSync(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

/** Every executable that looks like the official desktop build. */
export function findDesktopAppExecutables(): string[] {
  return Array.from(
    new Set([
      ...desktopAppSearchPaths().filter((p) => fs.existsSync(p)),
      ...scanForDesktopApp(),
      ...scanWindowsAppsPackages(),
    ])
  );
}

function isProcessRunning(names: string[]): boolean | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
        timeout: 5000,
        encoding: "utf8",
        windowsHide: true,
      });
      return names.some((name) => out.toLowerCase().includes(name.toLowerCase()));
    }
    const out = execFileSync("ps", ["-A", "-o", "comm="], { timeout: 5000, encoding: "utf8" });
    const haystack = out.toLowerCase();
    return names.some((name) => haystack.includes(name.replace(/\.exe$/i, "").toLowerCase()));
  } catch {
    // No tasklist / ps available: report "unknown" rather than inventing "no".
    return null;
  }
}

export interface DesktopAppProbeOptions {
  ports?: number[];
  /** Per-port network timeout. Keep it small: this runs on every detect. */
  timeoutMs?: number;
}

/**
 * Probe the desktop app: is it installed, is it running, and did anything
 * answer on a DevTools port?
 *
 * The port sweep is process-wide, not app-specific. If an unrelated tool is
 * listening on 9222, `endpointBrowser` names it, so the mismatch is visible
 * rather than silently mis-attributed.
 */
export async function probeDesktopApp(
  options: DesktopAppProbeOptions = {}
): Promise<DesktopAppProbe> {
  const timeoutMs = options.timeoutMs ?? 800;

  const executables = findDesktopAppExecutables();
  const installed = executables.length > 0;
  // The process is named after the executable. On Windows that is `ChatGPT.exe`
  // even though the package calls itself `OpenAI.Codex`, which is why both
  // names are checked.
  const running = isProcessRunning(["ChatGPT.exe", "ChatGPT", "Codex.exe"]);
  // Only a profile a live process is holding counts. A directory that merely
  // shares a word with the product name, and was left behind by something else,
  // is tracked separately so it can be named in the hint instead of mistaken
  // for the app's own data.
  const heldProfile = heldProfiles({ match: DESKTOP_PROFILE_MATCH })[0];
  const profileFiles = heldProfile !== undefined ? [heldProfile] : [];
  const staleProfiles = staleProfilePortFiles({ match: DESKTOP_PROFILE_MATCH });

  const attach = await findAttachEndpoint({
    ...(options.ports ? { ports: options.ports } : {}),
    match: DESKTOP_PROFILE_MATCH,
    liveProcess: "ChatGPT.exe",
    timeoutMs,
  });
  if (attach) {
    return {
      id: "chatgpt-desktop",
      displayName: "ChatGPT desktop",
      installed,
      executables,
      running,
      endpoint: attach.endpoint,
      endpointBrowser: attach.browser,
      profileFiles,
      hint: `Attaching is available at ${attach.endpoint} (${attach.browser ?? "unknown engine"}).`,
    };
  }

  // Running with no port means the app was started normally, which is the
  // common case and the one worth a precise instruction. The other two cases
  // are "not installed" and "installed but not started".
  const launchCommand = `"${executables[0]}" --remote-debugging-port=9222`;
  // Naming the leftover matters: a user who once started something by hand with
  // `--user-data-dir` under a similar path will otherwise assume that directory
  // is the app's, and wonder why the instructions do not match what they see.
  const staleNote =
    staleProfiles.length > 0
      ? ` (Ignoring ${staleProfiles.length} stale profile port file${staleProfiles.length === 1 ? "" : "s"} at ${path.dirname(staleProfiles[0])} — no process holds it.)`
      : "";

  const hint =
    !installed
      ? "Not installed. Install the official desktop app, or attach to Edge/Chrome started with --remote-debugging-port."
      : running === true
        ? `Running with no debug port. Close it, then start it as: ${launchCommand} — this build takes Chromium flags directly, ${WEBVIEW2_ARGS_ENV} is not involved.${staleNote}`
        : heldProfile !== undefined
          ? `A profile is held at ${heldProfile} but nothing answered on its port. Start the app, then re-run \`agent2llm detect\`.`
          : `Installed at ${executables[0]}, but no debug port is published. Start it as: ${launchCommand}.${staleNote}`;

  return {
    id: "chatgpt-desktop",
    displayName: "ChatGPT desktop",
    installed,
    executables,
    running,
    profileFiles,
    hint,
  };
}
