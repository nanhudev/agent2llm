/**
 * The `a2l pair` family, driven as a real process.
 *
 * `run-routing.test.mjs` proves which workflow a request picks; this file
 * proves the wiring behind it actually exists — that `pair create` writes a
 * pair, that a second identical create reuses it instead of forking a second
 * conversation, and that the refusals refuse.
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
const STATE = path.join(process.env.AGENT2LLM_STATE_DIR ?? ROOT, "cli-pair");

function a2l(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: STATE, NO_COLOR: "1" },
  });
}

function a2lJson(...args) {
  const result = a2l(...args, "--json");
  return { result, body: JSON.parse(result.stdout) };
}

test("cli-pair", "the CLI entry point is built and runnable", () => {
  assert(fs.existsSync(CLI), `${CLI} must exist — the suite runs against built output (npm run build)`);
});

test("cli-pair", "run with no pairs explains how to make one instead of guessing", () => {
  const result = a2l("run", "add a slugify function");
  assertEqual(result.status, 2, "a Relay run with nothing to pair must not proceed");
  assert(
    result.stdout.includes("a2l pair create"),
    `the failure has to name the fix, got: ${result.stdout.trim()}`
  );
});

test("cli-pair", "an empty state lists no pairs", () => {
  const { result, body } = a2lJson("pair", "list");
  assertEqual(result.status, 0, "listing an empty state is not an error");
  assertEqual(body.pairs.length, 0, "nothing has been created yet");
  assertEqual(body.corrupted.length, 0, "and nothing has been left half-written");
});

test("cli-pair", "pair create stores the context the user named", () => {
  const workspace = path.join(STATE, "workspace");
  const { result, body } = a2lJson(
    "pair",
    "create",
    "--brain",
    "mock-brain",
    "--harness",
    "mock-harness",
    "--workspace",
    workspace
  );
  assertEqual(result.status, 0, `create failed: ${result.stdout}${result.stderr}`);
  assertEqual(body.created, true, "the first create makes a pair");
  assertEqual(body.pair.brainAdapterId, "mock-brain", "the brain side is stored");
  assertEqual(body.pair.harnessAdapterId, "mock-harness", "the harness side is stored");
  assertEqual(body.pair.context.root, path.resolve(workspace), "the chosen folder is resolved and stored");
  assertEqual(body.pair.context.source, "user", "and is attributed to the user, not to a detection");
  assert(!("workspaceId" in body.pair), "a pair still must not require a workspace id");
});

test("cli-pair", "creating the same pair twice reuses it instead of forking a conversation", () => {
  const workspace = path.join(STATE, "workspace");
  const { result, body } = a2lJson(
    "pair",
    "create",
    "--brain",
    "mock-brain",
    "--harness",
    "mock-harness",
    "--workspace",
    workspace
  );
  assertEqual(result.status, 0, "re-creating is allowed and is not an error");
  assertEqual(body.created, false, "the second create reuses the pair — this is the anti-fork rule");
  assert(body.pair.pairId.length > 0, "the reused pair is reported in full");
});

test("cli-pair", "pair list shows the pair and its context", () => {
  const { result, body } = a2lJson("pair", "list");
  assertEqual(result.status, 0, "list succeeds");
  assertEqual(body.pairs.length, 1, "exactly the one pair exists");
  const human = a2l("pair", "list");
  assert(human.stdout.includes("mock-brain × mock-harness"), "the human form names both sides");
  assert(human.stdout.includes("harness-owned"), "and shows the context mode");
});

test("cli-pair", "pair show reports the pair and its (empty) run history", () => {
  const listed = a2lJson("pair", "list").body.pairs[0].pairId;
  const { result, body } = a2lJson("pair", "show", listed);
  assertEqual(result.status, 0, "show succeeds for an existing id");
  assertEqual(body.pair.pairId, listed, "the same pair comes back");
  assertEqual(body.runs.length, 0, "and it has no runs yet");
  assertEqual(body.pair.brainRef, null, "a pair that has never run has no conversation");
});

test("cli-pair", "pair show on an unknown id fails rather than inventing one", () => {
  const result = a2l("pair", "show", "a2lp_nope");
  assertEqual(result.status, 1, "an unknown pair is a failure");
  assert(result.stdout.includes("a2lp_nope"), "and the message quotes what was asked for");
});

test("cli-pair", "the adapters are checked for the side they are on", () => {
  const result = a2l("pair", "create", "--brain", "mock-harness", "--harness", "mock-brain");
  assertEqual(result.status, 2, "a harness cannot be a brain");
  assert(
    result.stdout.includes("is a harness, not a brain"),
    `naming the wrong flag is the point, got: ${result.stdout.trim()}`
  );
  const unknown = a2l("pair", "create", "--brain", "no-such-brain", "--harness", "mock-harness");
  assertEqual(unknown.status, 2, "an unknown adapter cannot be stored");
  assert(unknown.stdout.includes("Unknown adapter"), "and is reported as unknown");
});

test("cli-pair", "pair create refuses a context mode it cannot honour", () => {
  const result = a2l(
    "pair",
    "create",
    "--brain",
    "mock-brain",
    "--harness",
    "mock-harness",
    "--context-mode",
    "guessing"
  );
  assertEqual(result.status, 2, "an unknown mode is not silently defaulted");
  assert(result.stdout.includes("harness-owned"), "the message lists what is accepted");
});

test("cli-pair", "pair create refuses half a pair", () => {
  const result = a2l("pair", "create", "--brain", "mock-brain");
  assertEqual(result.status, 2, "one side is not a pair");
  assert(result.stdout.includes("--harness"), "and the missing flag is named");
});

test("cli-pair", "--pair with its own halves is refused", () => {
  const pairId = a2lJson("pair", "list").body.pairs[0].pairId;
  const result = a2l("run", "do something", "--pair", pairId, "--brain", "mock-brain");
  assertEqual(result.status, 2, "contradictory flags stop the run");
  assert(result.stdout.includes("--pair"), "and the message explains which flag to drop");
});

test("cli-pair", "a boolean flag does not swallow the goal that follows it", () => {
  // `--relay "goal"` used to parse as `relay: "goal"`, which silently turned the
  // run into brain-hands. The rejection below is only reachable when Relay was
  // actually selected, so it is the cheapest proof the parser is fixed.
  const result = a2l("run", "--relay", "add a slugify function", "--dry-run");
  assertEqual(result.status, 2, "Relay has no dry run, so this must stop");
  assert(
    result.stdout.includes("Relay Mode has no --dry-run"),
    `Relay was not selected — the goal was eaten by the flag: ${result.stdout.trim()}`
  );
});

test("cli-pair", "pair remove deletes the pair and says so", () => {
  const pairId = a2lJson("pair", "list").body.pairs[0].pairId;
  const { result, body } = a2lJson("pair", "remove", pairId);
  assertEqual(result.status, 0, "removing an existing pair succeeds");
  assertEqual(body.removed, true, "and reports that something was removed");
  assertEqual(a2lJson("pair", "list").body.pairs.length, 0, "the pair is gone");
  const again = a2l("pair", "remove", pairId);
  assertEqual(again.status, 1, "removing it twice is reported as nothing to remove");
});

await report();
