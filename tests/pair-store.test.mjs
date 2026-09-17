/**
 * A Pair is the durable thing; a Run is one goal through it.
 *
 * Two properties are under test here and both are load-bearing for Relay Mode:
 *
 * 1. **A pair outlives a goal.** The same brain conversation has to be usable
 *    for run #4 exactly as it was for run #1, so the pair — not the run, not
 *    the session — is what holds the conversation ref.
 * 2. **A pair is not a credential store.** The refs are adapter-owned and
 *    opaque, which is precisely why an adapter can be tempted to stuff a
 *    bearer token in there. The store refuses, and these tests assert the
 *    refusal instead of trusting the convention.
 *
 * The workspace is deliberately absent from the pair model: in Relay Mode the
 * Harness owns the context, so `workspaceId` is not required to create one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual, assertThrows } from "@agent2llm/testing";
import {
  PairStore,
  RunStore,
  assertSecretFree,
  createPair,
  createRunRecord,
  DEFAULT_EXECUTION_POLICY,
  touchPair,
} from "@agent2llm/pairs";
import { newId } from "@agent2llm/core";
import { report } from "./_report.mjs";

/**
 * Each test gets its own state directory. `getStateDir()` reads the env var at
 * call time, so this also proves the store does not cache a path at import.
 */
function withStateDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `a2l-pairs-${name}-`));
  process.env.AGENT2LLM_STATE_DIR = dir;
  return dir;
}

test("pair-store", "a pair can be created without a workspace", () => {
  withStateDir("create");
  const store = new PairStore();
  const pair = store.save(
    createPair({ pairId: newId("a2lp", 4), brainAdapterId: "chatgpt-web", harnessAdapterId: "codex" })
  );

  assert(!("workspaceId" in pair), "the pair model must not require a workspace");
  assertEqual(pair.contextMode, "harness-owned", "relay pairs default to harness-owned context");
  assertEqual(pair.brainRef, null, "a fresh pair has no brain conversation yet");
  assertEqual(pair.lastRunAt, null, "a fresh pair has never run");
  assertEqual(pair.executionPolicy.mode, DEFAULT_EXECUTION_POLICY.mode, "the relay policy is the default");
});

test("pair-store", "a saved pair is readable and the most recent one becomes active", async () => {
  withStateDir("resume");
  const store = new PairStore();
  const first = store.save(
    createPair({ pairId: newId("a2lp", 4), brainAdapterId: "chatgpt-web", harnessAdapterId: "codex" })
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = store.save(
    createPair({ pairId: newId("a2lp", 4), brainAdapterId: "claude-web", harnessAdapterId: "workbuddy" })
  );

  assertEqual(store.get(first.pairId).harnessAdapterId, "codex", "a pair round-trips through disk");
  assertEqual(store.active().pairId, second.pairId, "the newest pair is active before anything has run");

  // Resuming is not just reading: the conversation ref and the last-run stamp
  // have to survive a save, because that is what makes run #2 continue run #1.
  const resumed = touchPair({
    ...first,
    brainRef: { adapterId: "chatgpt-web", ref: { conversationId: "abc123" }, savedAt: new Date().toISOString() },
    lastRunAt: new Date(Date.now() + 5000).toISOString(),
  });
  store.save(resumed);

  const reloaded = store.get(first.pairId);
  assertEqual(reloaded.brainRef.ref.conversationId, "abc123", "the brain conversation ref must survive a save");
  assertEqual(store.active().pairId, first.pairId, "the most recently *used* pair wins, not the newest created");
});

test("pair-store", "a corrupted pair file is reported, not silently dropped or fatal", () => {
  const dir = withStateDir("corrupt");
  const store = new PairStore();
  store.save(createPair({ pairId: newId("a2lp", 4), brainAdapterId: "chatgpt-web", harnessAdapterId: "codex" }));

  fs.writeFileSync(path.join(dir, "pairs", "a2lp_broken.json"), "{ this is not json");
  fs.writeFileSync(
    path.join(dir, "pairs", "a2lp_wrongshape.json"),
    JSON.stringify({ pairId: "a2lp_wrongshape" })
  );

  const corrupted = store.corrupted();
  assertEqual(corrupted.length, 2, "both a malformed file and a wrong-shaped one are reported");
  // Listing must survive the damage: one bad file cannot hide the good pairs.
  assertEqual(store.list().length, 1, "the valid pair is still listed");
});

test("pair-store", "credential material is refused on write", () => {
  withStateDir("secrets");
  const store = new PairStore();
  const pair = createPair({ pairId: newId("a2lp", 4), brainAdapterId: "chatgpt-web", harnessAdapterId: "codex" });

  // A field name that is a credential by definition.
  assertThrows(
    () => store.save({ ...pair, executionPolicy: { ...pair.executionPolicy }, apiKey: "whatever" }),
    "a field called apiKey must not be persisted"
  );

  // A credential wearing an innocuous name, inside an adapter-owned ref.
  for (const token of [
    "sk-abcdefghij0123456789",
    "npm_abcdefghijklmnopqrstuvwx0123456789",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  ]) {
    assertThrows(
      () => store.save({ ...pair, brainRef: { adapterId: "api", ref: { conversationId: token }, savedAt: "now" } }),
      `a ${token.slice(0, 4)}-shaped value must not be persisted under an opaque ref`
    );
  }

  // The refusal is on the way in, so nothing reached the disk.
  assertEqual(store.list().length, 0, "no partial write survives a refused save");

  // And the check is structural, not a blanket ban on strings.
  assertSecretFree({ note: "conversation abc123", nested: { count: 3, flag: true } });
});

test("run-store", "a run records metrics and receipts, and never diffs", () => {
  withStateDir("runs");
  const pairStore = new PairStore();
  const runStore = new RunStore();
  const pair = pairStore.save(
    createPair({ pairId: newId("a2lp", 4), brainAdapterId: "chatgpt-web", harnessAdapterId: "codex" })
  );

  const run = runStore.save(createRunRecord({ runId: newId("a2lr", 4), pairId: pair.pairId, goal: "Add slugify" }));
  assertEqual(run.status, "running", "a new run starts running");
  assertEqual(run.metrics.testsPassed, null, "no test number measured yet is null, not zero");
  assertEqual(run.metrics.brainTokens, null, "no token accounting exists until a provider reports one");

  runStore.appendReceipt(run.runId, {
    receiptId: newId("a2lx", 4),
    runId: run.runId,
    iteration: 1,
    status: "success",
    exitStatus: "ok",
    changedFiles: ["src/slugify.ts"],
    tests: "6 passed",
    testsPassed: 6,
    commands: ["npm test"],
    errors: [],
    summary: "Added the function and its test.",
    durationMs: 1200,
    at: new Date().toISOString(),
  });

  const reloaded = runStore.get(run.runId);
  assertEqual(reloaded.receipts.length, 1, "the receipt is persisted");
  assertEqual(reloaded.receipts[0].testsPassed, 6, "the parsed test count is persisted");
  assertEqual(runStore.byPair(pair.pairId).length, 1, "runs are grouped by pair");
  assertEqual(runStore.unfinished().length, 1, "an unfinished run is resumable");
});

test("run-store", "a receipt summary is capped so a harness cannot write an essay", () => {
  withStateDir("receipt-cap");
  const runStore = new RunStore();
  const run = runStore.save(createRunRecord({ runId: newId("a2lr", 4), pairId: "a2lp_x", goal: "g" }));

  const receipt = {
    receiptId: newId("a2lx", 4),
    runId: run.runId,
    iteration: 1,
    status: "success",
    exitStatus: "ok",
    changedFiles: [],
    tests: null,
    testsPassed: null,
    commands: [],
    errors: [],
    summary: "x".repeat(5000),
    durationMs: 1,
    at: new Date().toISOString(),
  };

  // Zod rejects rather than truncating: a silently shortened summary is a
  // summary whose last sentence is a lie about where it ended.
  assertThrows(() => runStore.appendReceipt(run.runId, receipt), "an over-long summary must be rejected");
});

await report();
