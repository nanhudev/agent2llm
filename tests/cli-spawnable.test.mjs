/**
 * The binary `detect` found must be a binary execution can launch.
 *
 * On Windows these two disagree for every npm-installed CLI: `npm install -g`
 * writes an extensionless POSIX shim next to the `.cmd`, and discovery — which
 * treats any regular file as executable on Windows — reports the shim by name.
 * Node answers a direct spawn of that file with `EINVAL`, so the adapter died
 * launching a binary `detect` had just praised with a version number.
 *
 * The contract pinned here matches what `readVersion` already does for
 * probes: an extensionless shim launches through its shebang interpreter,
 * argv untouched; anything else launches as itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual, assertDeepEqual } from "@agent2llm/testing";
import { findInPath } from "@agent2llm/detect";
import { toSpawnable } from "@agent2llm/harness-cli-runtime";
import { report } from "./_report.mjs";

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `a2l-spawnable-${name}-`));
}

test("cli-spawnable", "a shebang shim launches through its interpreter on Windows, and as itself where shims are native", () => {
  const dir = scratch("shim");
  const shim = path.join(dir, "tool");
  fs.writeFileSync(shim, "#!/bin/sh\necho 1.2.3\n");

  const invocation = toSpawnable(shim, ["exec", "--json"]);
  if (process.platform === "win32") {
    assertEqual(invocation.bin, findInPath("sh"), "the shim must be handed to the sh on PATH");
    assertDeepEqual(invocation.args, [shim, "exec", "--json"], "the shim path and argv pass through untouched");
  } else {
    assertEqual(invocation.bin, shim, "on POSIX an extensionless script is a directly spawnable file");
    assertDeepEqual(invocation.args, ["exec", "--json"]);
  }
});

test("cli-spawnable", "a real executable keeps its own argv", () => {
  const dir = scratch("exe");
  const exe = path.join(dir, "tool.exe");
  fs.writeFileSync(exe, "binary");
  const invocation = toSpawnable(exe, ["--version"]);
  assertEqual(invocation.bin, exe, "an extension-bearing binary spawns directly on every platform");
  assertDeepEqual(invocation.args, ["--version"], "argv must not be rewritten");
});

test("cli-spawnable", "an extensionless file without a shebang is not silently transformed", () => {
  const dir = scratch("opaque");
  const opaque = path.join(dir, "mystery");
  fs.writeFileSync(opaque, "not a script with a shebang");
  const invocation = toSpawnable(opaque, ["run"]);
  assertEqual(invocation.bin, opaque, "the launch attempt stays with the original binary");
  assertDeepEqual(invocation.args, ["run"]);
  // The spawn will fail — loudly, with the transport's error naming the file —
  // instead of being quietly redirected somewhere nobody asked for.
});

test("cli-spawnable", "the interpreter route actually runs the shim end to end", async () => {
  // The contract above is shape only; this proves the shape runs. The stand-in
  // shim is a real script that prints a marker, launched exactly the way
  // `toSpawnable` says a harness would be on this platform.
  const { spawnSync } = await import("node:child_process");
  const dir = scratch("live");
  const shim = path.join(dir, "tool");
  const marker = `marker-${process.pid}`;
  fs.writeFileSync(shim, `#!/bin/sh\necho ${marker}\n`);
  // Only matters on POSIX (Windows treats the file the same either way), and
  // makes the stand-in honest: a shim that is not runnable is not a harness.
  fs.chmodSync(shim, 0o755);

  const invocation = toSpawnable(shim, []);
  const run = spawnSync(invocation.bin, invocation.args, { encoding: "utf8" });
  assert(run.status === 0, `the shim must exit 0: ${run.stderr}`);
  assert(run.stdout.includes(marker), `the shim must have run: ${run.stdout}`);
});

await report();
