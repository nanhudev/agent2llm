/**
 * Device pairing lives under `bridge`, not under `pair`.
 *
 * The word "pair" belonged to two unrelated operations at once: the
 * Brain×Harness Pair that Relay Mode runs through, and the workspace-vs-bridge
 * device pairing whose only connection was the vocabulary. This file pins the
 * fix — the device command answers to `a2l bridge pair` / `a2l bridge unpair`,
 * and the old spellings keep working *while saying so*, because a silently
 * renamed command is indistinguishable from a broken one.
 *
 * Subprocesses rather than imports on purpose: `apps/cli/src/index.ts` calls
 * `main()` on import, and a CLI that can only be tested by importing its
 * dispatch table is a CLI whose dispatch is never tested.
 *
 * The runner already gave this file a private `AGENT2LLM_STATE_DIR`; a subdir
 * of it is used so a stray write fails loudly instead of landing in the
 * developer's real state.
 */
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "apps", "cli", "dist", "index.js");
const STATE = path.join(process.env.AGENT2LLM_STATE_DIR ?? ROOT, "cli-bridge");

/**
 * `input: "\n"` answers runPair's "Press Enter when done" prompt, which
 * otherwise waits on a stdin that a spawned subprocess never feeds.
 */
function a2l(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    input: "\n",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: STATE, NO_COLOR: "1" },
  });
}

function workspaceDir(name) {
  const dir = path.join(STATE, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("cli-bridge", "bridge pair pairs a workspace without any deprecation noise", () => {
  const workspace = workspaceDir("primary");
  const result = a2l("bridge", "pair", workspace);
  assertEqual(result.status, 0, `bridge pair failed: ${result.stdout}${result.stderr}`);
  assert(result.stdout.includes("Pairing code:"), `expected a pairing code, got: ${result.stdout.trim()}`);
  assert(!result.stdout.includes("deprecated"), "the primary spelling must not call itself deprecated");
});

test("cli-bridge", "bridge unpair revokes without any deprecation noise", () => {
  const workspace = workspaceDir("primary");
  const result = a2l("bridge", "unpair", workspace);
  assertEqual(result.status, 0, `bridge unpair failed: ${result.stdout}${result.stderr}`);
  assert(result.stdout.includes("Revoked"), `expected the revocation receipt, got: ${result.stdout.trim()}`);
  assert(!result.stdout.includes("deprecated"), "the primary spelling must not call itself deprecated");
});

test("cli-bridge", "the legacy pair spelling still works and names its replacement", () => {
  const workspace = workspaceDir("legacy");
  const result = a2l("pair", workspace);
  assertEqual(result.status, 0, `legacy pair must keep working: ${result.stdout}${result.stderr}`);
  assert(result.stdout.includes("Pairing code:"), `the command itself must still function, got: ${result.stdout.trim()}`);
  assert(
    result.stdout.includes("deprecated") && result.stdout.includes("bridge pair"),
    `the deprecation notice must point at the new spelling, got: ${result.stdout.trim()}`
  );
});

test("cli-bridge", "the legacy unpair spelling still works and names its replacement", () => {
  const workspace = workspaceDir("legacy");
  const result = a2l("unpair", workspace);
  assertEqual(result.status, 0, `legacy unpair must keep working: ${result.stdout}${result.stderr}`);
  assert(
    result.stdout.includes("deprecated") && result.stdout.includes("bridge unpair"),
    `the deprecation notice must point at the new spelling, got: ${result.stdout.trim()}`
  );
});

test("cli-bridge", "a bare or unknown bridge subcommand explains the namespace instead of guessing", () => {
  const bare = a2l("bridge");
  assertEqual(bare.status, 2, "no subcommand is not a success");
  assert(bare.stdout.includes("bridge pair"), "the usage line shows the real command shape");

  const unknown = a2l("bridge", "frobnicate");
  assertEqual(unknown.status, 2, "an unknown subcommand is not a success");
  assert(unknown.stdout.includes("bridge unpair"), "the usage line shows the real command shape");
});

await report();
