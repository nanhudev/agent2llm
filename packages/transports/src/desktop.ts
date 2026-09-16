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
  existingDevToolsActivePortFiles,
  findAttachEndpoint,
} from "./browser.js";

/** The desktop build's own profile directories, as opposed to unrelated ones. */
const DESKTOP_PROFILE_MATCH = /chatgpt|openai/i;

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

/** Port sweeping lives in browser.ts, so every caller agrees on the list. */

/** Standard install locations for the official desktop build. */
export function desktopAppSearchPaths(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const pf = process.env.ProgramFiles ?? "";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "";
    return [
      path.join(local, "Programs", "ChatGPT", "ChatGPT.exe"),
      path.join(local, "ChatGPT", "ChatGPT.exe"),
      path.join(local, "Microsoft", "WindowsApps", "ChatGPT.exe"),
      path.join(pf, "ChatGPT", "ChatGPT.exe"),
      path.join(pf86, "ChatGPT", "ChatGPT.exe"),
    ];
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
 * Sweep the usual install roots for a ChatGPT directory. Installers move
 * things around between releases, so a fixed path list alone goes stale.
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
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue; // Not readable (e.g. WindowsApps): absence of evidence.
    }
    for (const entry of entries) {
      if (!/chatgpt/i.test(entry)) continue;
      const candidate =
        process.platform === "darwin"
          ? path.join(root, entry, "Contents", "MacOS", "ChatGPT")
          : path.join(root, entry, "ChatGPT.exe");
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
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

  const executables = Array.from(
    new Set([...desktopAppSearchPaths().filter((p) => fs.existsSync(p)), ...scanForDesktopApp()])
  );
  const installed = executables.length > 0;
  const running = isProcessRunning(["ChatGPT.exe", "ChatGPT"]);
  const profileFiles = existingDevToolsActivePortFiles({ match: DESKTOP_PROFILE_MATCH });

  const attach = await findAttachEndpoint({
    ...(options.ports ? { ports: options.ports } : {}),
    match: DESKTOP_PROFILE_MATCH,
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

  return {
    id: "chatgpt-desktop",
    displayName: "ChatGPT desktop",
    installed,
    executables,
    running,
    profileFiles,
    hint: !installed
      ? "Not installed. Install the official desktop app, or attach to Edge/Chrome started with --remote-debugging-port."
      : profileFiles.length > 0
        ? `Profile found at ${profileFiles[0]}, but nothing answered on its port — the app is most likely not running. Start it, then re-run \`agent2llm detect\`.`
        : `Installed, but no port is published. The engine has to be told to open one: set ${WEBVIEW2_ARGS_ENV}=--remote-debugging-port=9222 before launching, or add the same flag under HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments, then restart the app.`,
  };
}
