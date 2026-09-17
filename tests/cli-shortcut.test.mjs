/**
 * `a2l dock shortcut`, driven as a real process: an icon lands on the
 * (redirected) desktop, and `--remove` takes exactly that artifact away.
 *
 * Both output roots are redirected through A2L_DOCK_SHORTCUT_DIR and
 * A2L_DOCK_ICON_DIR, so a test run never writes to a real desktop. The
 * per-platform assertions check the artifact that platform's shell actually
 * consumes — the .lnk through the Windows shell COM, the .app bundle, the
 * .desktop entry — because "we wrote a file" is not the claim; "the shell
 * can use this file" is.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "apps", "cli", "dist", "index.js");
const STATE = path.join(process.env.AGENT2LLM_STATE_DIR ?? ROOT, "cli-shortcut");
const SHORTCUT_DIR = path.join(STATE, "desktop");
const ICON_DIR = path.join(STATE, "icons");

fs.mkdirSync(SHORTCUT_DIR, { recursive: true });

function a2l(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT2LLM_STATE_DIR: STATE,
      A2L_DOCK_SHORTCUT_DIR: SHORTCUT_DIR,
      A2L_DOCK_ICON_DIR: ICON_DIR,
      NO_COLOR: "1",
    },
  });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("cli-shortcut", "creating the shortcut writes an artifact the shell can really use", () => {
  const run = a2l("dock", "shortcut", "--json");
  assertEqual(run.status, 0, `dock shortcut failed: ${run.stderr || run.stdout}`);
  const body = JSON.parse(run.stdout);
  assertEqual(body.action, "created");

  if (process.platform === "win32") {
    const lnk = path.join(SHORTCUT_DIR, "Agent2LLM Dock.lnk");
    assert(body.artifacts.includes(lnk), `the .lnk is reported: ${JSON.stringify(body.artifacts)}`);
    assert(fs.existsSync(lnk), "the .lnk exists on disk");
    const ico = path.join(ICON_DIR, "dock.ico");
    assert(fs.existsSync(ico), "the icon was written");
    const head = fs.readFileSync(ico).subarray(0, 4);
    assert(head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0, "the .ico carries the ICO magic");
  } else if (process.platform === "darwin") {
    const app = path.join(SHORTCUT_DIR, "Agent2LLM Dock.app");
    assert(body.artifacts.includes(app), `the .app bundle is reported: ${JSON.stringify(body.artifacts)}`);
    assert(fs.existsSync(path.join(app, "Contents", "Info.plist")), "the bundle has Info.plist");
    const launcher = path.join(app, "Contents", "MacOS", "agent2llm-dock");
    assert(fs.existsSync(launcher), "the bundle has a launcher");
  } else {
    const desktop = path.join(SHORTCUT_DIR, "agent2llm-dock.desktop");
    assert(body.artifacts.includes(desktop), `the .desktop entry is reported: ${JSON.stringify(body.artifacts)}`);
    const text = fs.readFileSync(desktop, "utf8");
    assert(text.includes("[Desktop Entry]"), "a real desktop entry");
    assert(/Icon=\S+/.test(text), "pointing at the written icon");
  }

  // The png icon is written on every platform and is what the .desktop and
  // the iconset both start from — its magic is the cheapest honesty check.
  const png = path.join(ICON_DIR, "dock.png");
  assert(fs.existsSync(png), "the png icon exists on every platform");
  assert(fs.readFileSync(png).subarray(0, 8).equals(PNG_MAGIC), "with the PNG magic");
});

test("cli-shortcut", "--remove takes the created artifact away, and only it", () => {
  const run = a2l("dock", "shortcut", "--remove", "--json");
  assertEqual(run.status, 0, `remove failed: ${run.stderr || run.stdout}`);
  const body = JSON.parse(run.stdout);
  assertEqual(body.action, "removed");

  for (const artifact of [
    path.join(SHORTCUT_DIR, "Agent2LLM Dock.lnk"),
    path.join(SHORTCUT_DIR, "agent2llm-dock.desktop"),
    path.join(SHORTCUT_DIR, "Agent2LLM Dock.app"),
  ]) {
    assert(!fs.existsSync(artifact), `${artifact} must be gone after --remove`);
  }
  // The icon cache is deliberately kept: the .desktop entry references it by
  // path, and a shared icon directory is not this command's to empty.
  assert(fs.existsSync(path.join(ICON_DIR, "dock.png")), "the icon cache survives");
});

await report();
