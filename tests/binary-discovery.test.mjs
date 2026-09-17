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
import { newestInDirectory, homeDirectories, locateBinary, readShebang, readVersion, findInPath } from "@agent2llm/detect";
import { readHelp, helpMentions } from "@agent2llm/transports";
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
  // Windows treats any regular file as executable, POSIX does not: without an
  // x bit `isExecutable` rightly refuses the candidate and this test would
  // only ever pass on the author's platform. chmod is a no-op on Windows.
  if (process.platform !== "win32") fs.chmodSync(fake, 0o755);

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

/**
 * The subcommand must precede the help flag.
 *
 * `codex --help exec` asks the top-level parser for its own help and prints
 * "Commands: exec ..."; `codex exec --help` prints the flag surface, which is
 * where `--json` / `--sandbox` / `--cd` actually live. Getting the order wrong
 * returns plausible-looking output, so the build gets recorded as not
 * advertising flags it does support — resume silently stays off, and the
 * adapter stops passing `--json`.
 *
 * A shell script stands in for the real CLI so the assertion is about argv
 * order and nothing else.
 */
test("binary-discovery", "readHelp puts the subcommand before the help flag", async () => {
  const dir = scratch("help-order");
  // The fake must be spawnable by `child_process.spawn` without a shell, which
  // rules out a shebang script (Windows: ENOENT) and a `.cmd` (also ENOENT —
  // no shell means no batch handler). A small Node program is the one form
  // that works everywhere, and it reads argv the same way a real CLI does.
  const script = path.join(dir, "fake-cli.mjs");
  fs.writeFileSync(
    script,
    [
      "const [, , first] = process.argv;",
      'if (first === "exec") {',
      '  console.log("SUBCOMMAND HELP --json --sandbox RESUME");',
      "} else {",
      '  console.log("TOP LEVEL HELP Commands: exec resume");',
      "}",
      "",
    ].join("\n")
  );
  const fake = process.execPath;
  const argv = [script];

  const sub = await readHelp(fake, [...argv, "exec"]);
  assert(sub !== null, "the probe must return something");
  assert(sub.includes("SUBCOMMAND HELP"), `expected the subcommand surface, got: ${sub}`);
  assert(sub.includes("--json"), "the subcommand surface is where --json is advertised");

  // And the flag does not leak when no subcommand is asked for.
  const top = await readHelp(fake, argv);
  assert(top !== null, "a bare probe must still work");
  assert(top.includes("TOP LEVEL HELP"), `expected the top-level surface, got: ${top}`);
  assert(!top.includes("--json"), "the top-level surface does not advertise the subcommand's flags");

  // helpMentions is what turns that text into a capability fact.
  assert(helpMentions(sub, "--json"), "--json must be detected from the subcommand help");
  assert(!helpMentions(top, "--json"), "--json must not be detected from the top-level help");
});

/**
 * A version probe must answer "I don't know" rather than "here is an error".
 *
 * On Windows the fallback path runs through `cmd.exe`, which answers a missing
 * or unrunnable target in the console's own language: `'D:\…\codebuddy' 不是内部
 * 或外部命令`. Taking the first line of that put a Chinese error message in the
 * VERSION column of `agent2llm adapters` — worse than an honest `unknown`,
 * because it looks like data.
 *
 * The fake here is a real Node script whose *stdout* is an error string, so it
 * spawns cleanly and still prints garbage. That isolates the rejection rule
 * from the spawn mechanics. `readVersion` must return null, not the text.
 */
test("binary-discovery", "an error message is never reported as a version", async () => {
  const dir = scratch("diagnostic");
  const noisy = path.join(dir, "noisy-cli.mjs");
  const diagnostics = [
    "'D:\\tools\\codebuddy' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
    "bash: codex: command not found",
    "'x' is not recognized as an internal or external command",
    "no such file or directory",
  ];
  for (const diagnostic of diagnostics) {
    fs.writeFileSync(noisy, `console.log(${JSON.stringify(diagnostic)});\n`);
    const viaScript = await readVersion(noisy, 5000);
    assert(
      viaScript === null || !/不是内部|command not found|not recognized|no such file/i.test(viaScript),
      `readVersion must not return a diagnostic, got: ${viaScript}`
    );
  }
  // A genuine version still comes through — the rejection is not a blanket ban.
  const real = await readVersion(process.execPath, 8000);
  assert(real !== null && /^v?\d+\./.test(real), `node must still report its version, got: ${real}`);
});

/**
 * `npm install -g` writes a POSIX shim, and Windows cannot execute one.
 *
 * The shim declares its interpreter on line one: `#!/bin/sh` for npm's own
 * shim, `#!/usr/bin/env node` for most real CLI scripts. Both are POSIX paths,
 * but the interpreter name — `sh`, `node` — is usually already on PATH. The
 * probe therefore has to read the shebang and re-invoke the interpreter
 * instead of reporting `version: unknown` on the platform most users run.
 *
 * The assertion is on the interpreter *name* rather than on a version string,
 * so it holds on a machine without npm installed.
 */
test("binary-discovery", "a shebang shim is resolved through its interpreter", async () => {
  const dir = scratch("shebang");
  const shim = path.join(dir, "shim-cli");
  fs.writeFileSync(shim, "#!/bin/sh\necho 1.2.3\n");
  const envShim = path.join(dir, "env-cli");
  fs.writeFileSync(envShim, "#!/usr/bin/env node\nconsole.log('4.5.6');\n");
  const envMissing = path.join(dir, "env-missing-cli");
  fs.writeFileSync(envMissing, "#!/usr/bin/env not-an-interpreter-anywhere\necho 9.9.9\n");

  assertEqual(readShebang(shim), findInPath("sh"), "`#!/bin/sh` resolves to the sh on PATH");
  assertEqual(readShebang(envShim), findInPath("node"), "`env X` must resolve to X, not be dropped");
  assertEqual(
    readShebang(envMissing),
    null,
    "an interpreter that is not installed must not be invented"
  );
  assertEqual(readShebang(path.join(dir, "absent")), null, "a missing file is not an error");
});

await report();
