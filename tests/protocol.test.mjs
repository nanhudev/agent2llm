/**
 * A2L protocol tests: state machine, envelope validation, size budget and
 * the text wire format used by web Brains.
 */
import {
  A2L_STATES,
  canTransition,
  nextSpeaker,
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
import { A2L_MUTABLE_STATES as A2L_MUTABLE_STATES_OF_PROTOCOL } from "@agent2llm/protocol";
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
  assertEqual(A2L_STATES.length, 16, "state count changed; update the docs and tests");
  assert(new Set(A2L_STATES).size === A2L_STATES.length, "states must be unique");
});

/**
 * Relay Mode added NEXT_ACTION, and adding a state is a protocol change: it
 * has to be reachable, it has to lead somewhere, and it must not become a
 * second way to express a plan that already exists.
 */
test("protocol", "NEXT_ACTION fits the machine without replacing PLAN", () => {
  assert(A2L_STATES.includes("NEXT_ACTION"), "the state is part of the protocol");
  assert(canTransition("INIT", "NEXT_ACTION"), "a relay Brain may answer INIT with a step");
  assert(canTransition("EXECUTED", "NEXT_ACTION"), "and may answer evidence with the next step");
  assert(canTransition("EXECUTED", "DONE"), "or answer it with a verdict, without a REVIEWING detour");
  assert(canTransition("EXECUTED", "REVISE"), "including a revision");
  assert(canTransition("NEXT_ACTION", "DISPATCHED"), "a step is what gets dispatched");
  assert(!canTransition("NEXT_ACTION", "EXECUTED"), "a step cannot skip its own execution");
  assertEqual(nextSpeaker("NEXT_ACTION"), "core", "the core dispatches, the Brain does not");
  assert(canTransition("INIT", "PLAN"), "PLAN is still reachable; old workflows are unchanged");
});

/**
 * The Brain may ask to see one file's diff instead of judging from a line
 * count. That answer has to be a state of its own: it is not an execution, and
 * the state machine is where "nothing was executed" is enforced.
 */
test("protocol", "EVIDENCE_DETAIL answers a detail request without executing", () => {
  assert(canTransition("NEXT_ACTION", "EVIDENCE_DETAIL"), "a step may be answered with the detail it asked for");
  assert(canTransition("EVIDENCE_DETAIL", "NEXT_ACTION"), "and the Brain then names a step");
  assert(canTransition("EVIDENCE_DETAIL", "DONE"), "or decides the run is finished");
  assertEqual(nextSpeaker("EVIDENCE_DETAIL"), "brain", "the core supplies detail, the Brain judges it");
  assert(
    !(A2L_MUTABLE_STATES_OF_PROTOCOL.includes("EVIDENCE_DETAIL")),
    "reading a diff must never be a workspace-mutation state"
  );
  assert(
    canTransition("NEXT_ACTION", "DISPATCHED") && canTransition("NEXT_ACTION", "EVIDENCE_DETAIL"),
    "both paths out of NEXT_ACTION stay available"
  );
});

test("protocol", "a NEXT_ACTION block round-trips with its acceptance criteria", () => {
  const message = createControlMessage(
    "NEXT_ACTION",
    {
      task: "Fix Codex discovery so Agent2LLM detects ~/.codex/.sandbox-bin/codex.exe",
      acceptance: ["agent2llm detect shows Codex", "the real version is reported"],
      filesLikelyInvolved: ["packages/harnesses/codex/src/index.ts"],
    },
    BASE
  );
  const parsed = parseControlBlock(encodeControlMessage(message));
  assert(parsed.ok, `the wire format must carry the new state: ${parsed.ok ? "" : parsed.error}`);
  assertEqual(parsed.message.type, "NEXT_ACTION", "state survives");
  assertEqual(parsed.message.payload.acceptance.length, 2, "acceptance criteria survive");
  assertEqual(
    parsed.message.payload.filesLikelyInvolved[0],
    "packages/harnesses/codex/src/index.ts",
    "the file hint survives"
  );
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

/**
 * An execution that changed nothing is a real outcome — a Relay step that only
 * inspected the repository produces one — and the text wire format omits empty
 * arrays. Without a default on `changedFiles` the key disappears and the whole
 * message fails to parse, which is how a Brain ends up unable to read a control
 * block Agent2LLM just sent it.
 */
test("protocol", "an execution that changed nothing still round-trips", () => {
  const message = createControlMessage(
    "EXECUTED",
    {
      result: "Inspected the repository; nothing needed to change.",
      changedFiles: [],
      tests: null,
      exitStatus: "ok",
      commands: [],
      evidence: "Execution #1",
    },
    BASE
  );
  const parsed = parseControlBlock(encodeControlMessage(message));
  assert(parsed.ok, `an empty change list must survive the wire: ${parsed.ok ? "" : parsed.error}`);
  assertEqual(parsed.message.type, "EXECUTED", "the state survives");
  assertEqual(parsed.message.payload.changedFiles.length, 0, "and no files comes back as no files, not an error");
  assertEqual(parsed.message.payload.evidence, "Execution #1", "the evidence travels with it");
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
