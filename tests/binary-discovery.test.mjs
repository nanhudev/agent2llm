/**
 * Finding a CLI that a desktop app hid from PATH.
 *
 * Codex Desktop is the case that motivated this: it stages a complete
 * `codex.exe` under `$CODEX_HOME/.sandbox-bin` and deliberately keeps it off
 * PATH, because the binary belongs to the app rather than to the shell. Before
 * the probe existed, `agent2llm detect` reported Codex as unimplemented on a
 * machine where Codex was installed and signed in.
 *
 * The rotation is the second half of the problem. That directory also
 * accumulates versioned `codex-command-runner-*.exe` files, so a fixed
 * filename would pin an old build. The newest entry is what we want.
 *
 * Everything here runs against a throwaway directory tree, so the assertions
 * describe the discovery rule rather than this particular machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { newestInDirectory, homeDirectories, locateBinary } from "@agent2llm/detect";
import { report } from "./_report.mjs";

function scratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `a2l-detect-${name}-`));
  return dir;
}

test("binary-discovery", "the newest versioned binary wins, not the first listed", async () => {
  const dir = scratch("versioned");
  const pattern = /^codex-command-runner-[\d.]+(?:-[a-z]+\.[\d.]+)*\.exe$/i;

  // Deliberately create the oldest first so readdir order cannot decide this.
  const older = path.join(dir, "codex-command-runner-0.153.0.exe");
  fs.writeFileSync(older, "old");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const newest = path.join(dir, "codex-command-runner-0.154.0-alpha.6.2.exe");
  fs.writeFileSync(newest, "new");

  assertEqual(newestInDirectory(dir, pattern), newest, "the newest mtime must win");

  // A pattern that matches nothing must not fall back to "any file".
  assertEqual(newestInDirectory(dir, /^does-not-exist$/), null, "no match means no match");
  assertEqual(newestInDirectory(path.join(dir, "missing"), pattern), null, "a missing dir is not an error");
});

test("binary-discovery", "unversioned siblings are ignored by a versioned pattern", async () => {
  const dir = scratch("mixed");
  fs.writeFileSync(path.join(dir, "codex.exe"), "plain");
  fs.writeFileSync(path.join(dir, "codex-code-mode-host.exe"), "helper");
  const runner = path.join(dir, "codex-command-runner-0.154.0-alpha.6.2.exe");
  fs.writeFileSync(runner, "runner");

  const found = newestInDirectory(dir, /^codex-command-runner-[\d.]+(?:-[a-z]+\.[\d.]+)*\.exe$/i);
  assertEqual(found, runner, "only the versioned runner matches");
});

test("binary-discovery", "homeDirectories expands against a home, never the cwd", async () => {
  const dirs = homeDirectories([".codex/.sandbox-bin"]);
  assertEqual(dirs.length, 1, "one relative directory in, one absolute out");
  assert(dirs[0].startsWith(os.homedir()), `${dirs[0]} must be anchored to the home directory`);
  assert(dirs[0].endsWith(path.join(".codex", ".sandbox-bin")), `${dirs[0]} must keep its relative tail`);
});

test("binary-discovery", "a candidate path is preferred over a PATH lookup miss", async () => {
  const dir = scratch("candidate");
  const fake = path.join(dir, `probe-${process.pid}.exe`);
  fs.writeFileSync(fake, "not a real program");

  const found = await locateBinary(`definitely-absent-${process.pid}`, {
    candidates: [fake],
    probeVersion: false,
  });
  assert(found !== null, "the candidate must be found");
  assertEqual(found.path, fake, "the candidate path is what gets reported");
  assertEqual(found.source, "candidate", "discovery must say where it came from");
  assertEqual(found.version, null, "probeVersion:false must not shell out");
});

test("binary-discovery", "versioned directories are only consulted when a pattern is given", async () => {
  const dir = scratch("gated");
  const runner = path.join(dir, "codex-command-runner-0.154.0-alpha.6.2.exe");
  fs.writeFileSync(runner, "runner");

  const withoutPattern = await locateBinary(`absent-${process.pid}`, {
    versionedDirs: [dir],
    probeVersion: false,
  });
  assertEqual(withoutPattern, null, "a versioned dir without a pattern must be inert");

  const withPattern = await locateBinary(`absent-${process.pid}`, {
    versionedDirs: [dir],
    versionedPattern: /^codex-command-runner-[\d.]+(?:-[a-z]+\.[\d.]+)*\.exe$/i,
    probeVersion: false,
  });
  assert(withPattern !== null, "the pattern is what activates the scan");
  assertEqual(withPattern.source, "candidate", "a versioned hit is still a candidate source");
});

await report();
