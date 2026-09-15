/**
 * A2L protocol tests: state machine, envelope validation, size budget and
 * the text wire format used by web Brains.
 */
import {
  A2L_STATES,
  canTransition,
  createControlMessage,
  parseControlMessage,
  validateTransition,
  encodeControlMessage,
  parseControlBlock,
  extractControlBlock,
  exceedsWebBudget,
  buildHandoff,
  assertHandoffIsBrief,
  mapC2CState,
  fromC2CState,
  toC2CState,
  c2cRecordToA2LExecuted,
} from "@agent2llm/protocol";
import { test, assert, assertEqual, assertThrows } from "@agent2llm/testing";
import { SAMPLE_CONTROL_BLOCKS, CHAT_REPLY_WITH_PROSE } from "@agent2llm/fixtures";
import { report } from "./_report.mjs";

const BASE = {
  sessionId: "a2ls_test",
  taskId: "a2lt_test",
  workspaceId: "a2lw_test",
  iteration: 0,
  sender: { role: "core", adapter: "core" },
};

test("protocol", "every state is reachable and finite", () => {
  assertEqual(A2L_STATES.length, 14, "state count changed; update the docs and tests");
  assert(new Set(A2L_STATES).size === A2L_STATES.length, "states must be unique");
});

test("protocol", "BOOTSTRAP -> READY -> INIT is the only sane opening", () => {
  assert(canTransition("BOOTSTRAP", "READY"), "BOOTSTRAP -> READY");
  assert(canTransition("READY", "INIT"), "READY -> INIT");
  assert(!canTransition("BOOTSTRAP", "DONE"), "BOOTSTRAP cannot jump to DONE");
});

test("protocol", "illegal transitions are rejected", () => {
  assert(!canTransition("DONE", "EXECUTING"), "a DONE task cannot start executing");
  assert(!canTransition("READY", "EXECUTED"), "EXECUTED requires execution");
  const verdict = validateTransition("DONE", "PLAN");
  assertEqual(verdict.ok, false, "must be rejected");
  assertEqual(verdict.reason, "illegal_transition", "rejection reason");
});

test("protocol", "unknown states are rejected", () => {
  const verdict = validateTransition("NOPE", "DONE");
  assertEqual(verdict.ok, false);
  assertEqual(verdict.reason, "unknown_state");
});

test("protocol", "envelope round-trips through validation", () => {
  const message = createControlMessage("PLAN", {
    goal: "Add dark mode",
    rationale: "hardcoded colours",
    actions: ["add provider"],
    filesLikelyInvolved: [],
    tests: "",
    successCriteria: "toggle works",
  }, BASE);
  const parsed = parseControlMessage(message);
  assert(parsed.ok, "envelope must validate");
  assertEqual(parsed.value.type, "PLAN");
  assertEqual(parsed.value.payload.goal, "Add dark mode");
});

test("protocol", "payloads are validated per state", () => {
  const bad = createControlMessage("PLAN", { goal: "" }, BASE);
  const parsed = parseControlMessage(bad);
  assertEqual(parsed.ok, false, "an empty goal must be rejected");
});

test("protocol", "web control blocks parse back to envelopes", () => {
  const parsed = parseControlBlock(SAMPLE_CONTROL_BLOCKS.plan);
  assert(parsed.ok, `parse failed: ${parsed.error ?? ""}`);
  assertEqual(parsed.message.type, "PLAN");
  assertEqual(parsed.message.payload.goal, "Add dark mode");
  assertEqual(parsed.message.payload.actions.length, 2, "both actions must survive");
  assertEqual(parsed.message.sender.role, "brain");
});

test("protocol", "prose around a control block is ignored", () => {
  const block = extractControlBlock(CHAT_REPLY_WITH_PROSE);
  assert(block !== null, "block must be found");
  assert(block.startsWith("[A2L]"), "extraction starts at the marker");
  assert(parseControlBlock(CHAT_REPLY_WITH_PROSE).ok, "must still parse");
});

test("protocol", "wire round-trip preserves typed payloads", () => {
  const message = createControlMessage("EXECUTED", {
    result: "tests pass",
    changedFiles: ["src/a.ts", "src/b.ts"],
    tests: "12 passed",
    exitStatus: "ok",
    commands: ["npm test"],
  }, { ...BASE, iteration: 1 });
  const wire = encodeControlMessage(message);
  const parsed = parseControlBlock(wire);
  assert(parsed.ok, `wire parse failed: ${parsed.error ?? ""}`);
  assertEqual(parsed.message.payload.changedFiles.length, 2, "array payload survives");
  assertEqual(parsed.message.iteration, 1, "iteration survives");
});

test("protocol", "control messages stay inside the web budget", () => {
  const message = createControlMessage("PLAN", {
    goal: "x".repeat(200),
    rationale: "y".repeat(300),
    actions: ["a".repeat(100)],
    filesLikelyInvolved: [],
    tests: "",
    successCriteria: "z".repeat(200),
  }, BASE);
  assert(!exceedsWebBudget(message), "a small plan must fit in 1KB");
});

test("protocol", "HANDOFF is a brief, never a data dump", () => {
  const handoff = buildHandoff({
    originalGoal: "Add dark mode",
    progress: ["added provider", "added toggle"],
    currentState: "REVIEWING",
    knownIssues: ["one test fails"],
    nextExpectedStep: "Fix the failing toggle test",
  });
  assertHandoffIsBrief(handoff);
  assertEqual(handoff.progress.length, 2);
});

test("protocol", "HANDOFF refuses code blocks", () => {
  const handoff = buildHandoff({
    originalGoal: "g",
    currentState: "s",
    nextExpectedStep: "```\nhuge diff here\n```",
  });
  assertThrows(() => assertHandoffIsBrief(handoff), "code fences must be rejected");
});

test("protocol", "C2C states map onto A2L", () => {
  assertEqual(mapC2CState("INIT"), "INIT");
  assertEqual(mapC2CState("PLAN"), "PLAN");
  assertEqual(mapC2CState("EXECUTED"), "EXECUTED");
  assertEqual(mapC2CState("DONE"), "DONE");
  assertEqual(mapC2CState("HANDOFF"), "HANDOFF");
  assertEqual(mapC2CState("NOT_A_STATE"), null, "unknown states map to null, not a guess");

  assertEqual(toC2CState("REVIEWING"), "REVIEW", "A2L REVIEWING is C2C REVIEW");
  assertEqual(toC2CState("BOOTSTRAP"), null, "local-only states have no C2C counterpart");
  assertEqual(fromC2CState("EXECUTING"), "DISPATCHED", "C2C EXECUTING maps to the dispatch boundary");
});

test("protocol", "C2C execution records convert to A2L EXECUTED", () => {
  const payload = c2cRecordToA2LExecuted({
    taskId: "t1",
    iteration: 2,
    changedFiles: ["a.ts"],
    tests: "3 passed",
    exitStatus: "ok",
  });
  assertEqual(payload.changedFiles.length, 1);
  assertEqual(payload.tests, "3 passed");
  assertEqual(payload.commands.length, 0, "C2C records carry no command list");
});


await report();
