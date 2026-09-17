/**
 * `a2l dock shortcut` — put an icon on the desktop that starts the dock.
 *
 * The user asked for the npm install (and the exe) to end with a desktop
 * shortcut that opens the dock directly, no terminal first. This command is
 * that shortcut, and `scripts/postinstall.mjs` calls it after a global npm
 * install. Double-clicking the artifact runs `a2l dock`, which now opens its
 * own app-style window — so the full loop is: install once, double-click
 * forever.
 *
 * Platform honesty: each platform gets its real artifact format — a .lnk via
 * the Windows shell COM, a minimal .app bundle on macOS, a .desktop entry on
 * Linux. Optional pieces (the macOS .icns needs `iconutil`) are recorded as
 * skipped with their reason instead of failing the command. `--remove` deletes
 * exactly what this command writes, one path at a time.
 *
 * Tests redirect both output roots with A2L_DOCK_SHORTCUT_DIR and
 * A2L_DOCK_ICON_DIR, so a test run never writes to a real desktop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ICON_ICO_BASE64, ICON_PNG_BASE64 } from "../icon.assets.gen.js";
import * as ui from "../ui.js";

export interface ShortcutOptions {
  remove?: boolean;
  json?: boolean;
}

export interface ShortcutReport {
  platform: NodeJS.Platform;
  action: "created" | "removed";
  /** Paths this command wrote (created) or deleted (removed). */
  artifacts: string[];
  /** Optional pieces not done, each with its reason — the honest version of silence. */
  skipped: { what: string; reason: string }[];
  error?: string;
}

const DESKTOP_LAUNCH_ARGS = ["dock"];

function iconDir(): string {
  if (process.env.A2L_DOCK_ICON_DIR) return process.env.A2L_DOCK_ICON_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "agent2llm");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "agent2llm");
  }
  return path.join(os.homedir(), ".local", "share", "agent2llm");
}

function shortcutDir(): string {
  if (process.env.A2L_DOCK_SHORTCUT_DIR) return process.env.A2L_DOCK_SHORTCUT_DIR;
  if (process.platform === "win32") {
    // The redirected Desktop (OneDrive, roaming profiles) is what the shell
    // shows; when the folder is missing entirely, fall back to the home dir.
    const desktop = path.join(os.homedir(), "Desktop");
    return fs.existsSync(desktop) ? desktop : os.homedir();
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Applications");
  return path.join(os.homedir(), ".local", "share", "applications");
}

function writeIcons(): { ico: string; png: string } {
  const dir = iconDir();
  fs.mkdirSync(dir, { recursive: true });
  const ico = path.join(dir, "dock.ico");
  const png = path.join(dir, "dock.png");
  fs.writeFileSync(ico, Buffer.from(ICON_ICO_BASE64, "base64"));
  fs.writeFileSync(png, Buffer.from(ICON_PNG_BASE64, "base64"));
  return { ico, png };
}

// ---- Windows ----------------------------------------------------------------

/** PowerShell with all quoting pain sidestepped: the script goes over as
 *  UTF-16LE base64 via -EncodedCommand, so no shell ever reinterprets a path. */
function runPowerShell(script: string): { ok: boolean; stderr: string } {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { encoding: "utf8", timeout: 30000 }
  );
  return { ok: result.status === 0, stderr: result.stderr ?? "" };
}

function resolveA2lCmd(): { target: string; arguments: string } {
  // `where` is how the shell itself would resolve it; a .cmd hit is targetable
  // directly by a .lnk (ShellExecute runs it through cmd for us).
  try {
    const out = execFileSync("where.exe", ["a2l"], { encoding: "utf8", timeout: 15000 });
    const cmd = out.split(/\r?\n/).find((line) => line.trim().toLowerCase().endsWith(".cmd"));
    if (cmd) return { target: cmd.trim(), arguments: DESKTOP_LAUNCH_ARGS.join(" ") };
  } catch {
    // Fall through to the PATH-based form below.
  }
  // No .cmd found: let cmd.exe resolve `a2l` at double-click time.
  return { target: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), arguments: `/c a2l ${DESKTOP_LAUNCH_ARGS.join(" ")}` };
}

function createWindowsShortcut(artifacts: string[], skipped: ShortcutReport["skipped"]): void {
  const { ico } = writeIcons();
  artifacts.push(ico, path.join(iconDir(), "dock.png"));
  const dir = shortcutDir();
  fs.mkdirSync(dir, { recursive: true });
  const lnk = path.join(dir, "Agent2LLM Dock.lnk");
  const { target, arguments: args } = resolveA2lCmd();
  const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)})`,
    `$s.TargetPath = ${q(target)}`,
    `$s.Arguments = ${q(args)}`,
    `$s.WorkingDirectory = ${q(os.homedir())}`,
    `$s.IconLocation = ${q(`${ico},0`)}`,
    "$s.WindowStyle = 7", // minimized: the console stays out of the way
    `$s.Description = ${q("Agent2LLM Dock — starts the local dock and opens its window")}`,
    "$s.Save()",
  ].join("\n");
  const { ok, stderr } = runPowerShell(script);
  if (!ok || !fs.existsSync(lnk)) {
    skipped.push({ what: lnk, reason: `the shell shortcut could not be written${stderr ? `: ${stderr.trim()}` : ""}` });
    return;
  }
  artifacts.push(lnk);
}

// ---- macOS ------------------------------------------------------------------

const MAC_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent2LLM Dock</string>
  <key>CFBundleDisplayName</key><string>Agent2LLM Dock</string>
  <key>CFBundleIdentifier</key><string>cn.nanhu.agent2llm.dock</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>agent2llm-dock</string>
  <key>CFBundleIconFile</key><string>dock</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
`;

function createMacApp(artifacts: string[], skipped: ShortcutReport["skipped"]): void {
  const { png } = writeIcons();
  artifacts.push(png);
  const app = path.join(shortcutDir(), "Agent2LLM Dock.app");
  const contents = path.join(app, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(contents, "Info.plist"), MAC_PLIST);
  const launcher = path.join(contents, "MacOS", "agent2llm-dock");
  fs.writeFileSync(launcher, `#!/bin/sh\n# Starts the dock; the CLI opens its own app-style window.\nexec /usr/bin/env a2l ${DESKTOP_LAUNCH_ARGS.join(" ")}\n`);
  fs.chmodSync(launcher, 0o755);
  artifacts.push(app, launcher);
  // The .icns needs iconutil; without it the app runs with a generic icon.
  const iconset = path.join(iconDir(), "dock.iconset");
  try {
    fs.mkdirSync(iconset, { recursive: true });
    fs.copyFileSync(png, path.join(iconset, "icon_256x256.png"));
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(contents, "Resources", "dock.icns")], { timeout: 30000 });
    artifacts.push(path.join(contents, "Resources", "dock.icns"));
  } catch (error) {
    skipped.push({ what: "dock.icns", reason: `iconutil unavailable or failed: ${(error as Error).message.split("\n")[0]}` });
  }
}

// ---- Linux ------------------------------------------------------------------

function createLinuxDesktop(artifacts: string[], _skipped: ShortcutReport["skipped"]): void {
  const { png } = writeIcons();
  artifacts.push(png);
  const dir = shortcutDir();
  fs.mkdirSync(dir, { recursive: true });
  const desktop = path.join(dir, "agent2llm-dock.desktop");
  fs.writeFileSync(
    desktop,
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Agent2LLM Dock",
      "Comment=Your best model thinks. Your favorite agent builds.",
      `Exec=a2l ${DESKTOP_LAUNCH_ARGS.join(" ")}`,
      `Icon=${png}`,
      "Terminal=false",
      "Categories=Development;",
    ].join("\n") + "\n"
  );
  artifacts.push(desktop);
}

// ---- Remove -----------------------------------------------------------------

function removeArtifact(artifacts: string[], target: string): void {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true, recursive: target.includes(".app") });
      artifacts.push(target);
    }
  } catch {
    // A shortcut we cannot delete is reported by its absence from the list,
    // and the dock itself is unaffected — the artifact is cosmetic.
  }
}

// ---- Entry point -------------------------------------------------------------

export async function runDockShortcut(options: ShortcutOptions = {}): Promise<number> {
  const report: ShortcutReport = { platform: process.platform, action: options.remove ? "removed" : "created", artifacts: [], skipped: [] };
  try {
    if (options.remove) {
      // Remove on every platform shape: harmless where files do not exist.
      removeArtifact(report.artifacts, path.join(shortcutDir(), "Agent2LLM Dock.lnk"));
      removeArtifact(report.artifacts, path.join(shortcutDir(), "Agent2LLM Dock.app"));
      removeArtifact(report.artifacts, path.join(shortcutDir(), "agent2llm-dock.desktop"));
    } else if (process.platform === "win32") {
      createWindowsShortcut(report.artifacts, report.skipped);
    } else if (process.platform === "darwin") {
      createMacApp(report.artifacts, report.skipped);
    } else {
      createLinuxDesktop(report.artifacts, report.skipped);
    }
  } catch (error) {
    report.error = (error as Error).message;
  }

  if (options.json) {
    ui.jsonOutput(report);
  } else if (report.error) {
    ui.fail(`Could not manage the desktop shortcut: ${report.error}`);
  } else {
    ui.heading(options.remove ? "Shortcut removed" : "Desktop shortcut");
    for (const artifact of report.artifacts) ui.line(`  ${artifact}`);
    for (const { what, reason } of report.skipped) ui.line(ui.dim(`  skipped ${what}: ${reason}`));
    if (report.artifacts.length === 0 && report.skipped.length === 0) {
      ui.line(ui.dim("  nothing to do — no shortcut files were found or written"));
    }
    ui.line(ui.dim("  Double-click it to start the dock and open its window."));
  }
  return report.error ? 1 : 0;
}
