/**
 * Opening the dock page without making the user click a printed URL.
 *
 * The preference order is deliberate. A Chromium `--app=` window has no tabs,
 * no address bar and no bookmarks — it looks and behaves like a desktop
 * application window, which is exactly the "convenient frontend" experience,
 * and it costs zero dependencies because Edge ships with Windows and Chrome
 * with most macOS/Linux setups. Only when neither is found do we fall back to
 * the system default browser via `start`/`open`/`xdg-open`.
 *
 * Two hard rules:
 * - Opening a window never touches a window that already exists. This launch
 *   path creates its own frame; nothing is reparented, moved or resized, which
 *   is the property the dock's security posture is built on.
 * - Failure is never fatal. A machine where every launcher probe fails still
 *   gets a working dock and a printed URL — the opener is a convenience, and
 *   the caller renders its outcome as one line, not as an error path.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";

export interface OpenOutcome {
  /** "app-window" when a Chromium --app frame was launched, "browser" otherwise. */
  kind: "app-window" | "browser" | null;
  /** What actually launched, e.g. "Microsoft Edge (--app window)". */
  how: string | null;
  /** Present when nothing could be launched; the dock itself is unaffected. */
  error?: string;
}

/** Chromium binaries that can host an --app window, best candidate first. */
function appWindowCandidates(): { path: string; label: string; args: string[] }[] {
  if (process.platform === "win32") {
    const roots = [
      process.env["ProgramFiles(x86)"],
      process.env["ProgramFiles"],
      process.env["LocalAppData"],
    ].filter((root): root is string => typeof root === "string" && root !== "");
    const out: { path: string; label: string; args: string[] }[] = [];
    for (const root of roots) {
      out.push({
        path: `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
        label: "Microsoft Edge (--app window)",
        args: [],
      });
      out.push({
        path: `${root}\\Google\\Chrome\\Application\\chrome.exe`,
        label: "Google Chrome (--app window)",
        args: [],
      });
    }
    return out;
  }
  if (process.platform === "darwin") {
    return [
      { path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", label: "Microsoft Edge (--app window)", args: [] },
      { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", label: "Google Chrome (--app window)", args: [] },
    ];
  }
  return [];
}

function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function openDockWindow(url: string): Promise<OpenOutcome> {
  // An --app frame first: a window that looks like the product, not a tab.
  for (const candidate of appWindowCandidates()) {
    try {
      if (!fs.statSync(candidate.path).isFile()) continue;
      launchDetached(candidate.path, [`--app=${url}`, "--window-size=1280,900", ...candidate.args]);
      return { kind: "app-window", how: candidate.label };
    } catch {
      // Try the next candidate; the default-browser fallback is still ahead.
    }
  }

  try {
    if (process.platform === "win32") {
      // `start` is a cmd builtin, and the empty first argument is its window
      // title slot — without it a URL with special characters is eaten.
      launchDetached("cmd.exe", ["/c", "start", "", url]);
      return { kind: "browser", how: "the default browser" };
    }
    if (process.platform === "darwin") {
      launchDetached("open", [url]);
      return { kind: "browser", how: "the default browser" };
    }
    launchDetached("xdg-open", [url]);
    return { kind: "browser", how: "the default browser" };
  } catch (error) {
    return { kind: null, how: null, error: (error as Error).message };
  }
}
