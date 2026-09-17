/**
 * What a relay dispatch is allowed to say to the Harness.
 *
 * The economy of Relay Mode is entirely in this prompt. A Harness given a
 * *goal* re-derives the plan the Brain already made — it reads the repository,
 * chooses an approach, executes, and writes a document about having done so.
 * Every one of those steps is work the Brain already paid for, repeated at the
 * Harness's prices, and the document is a file the user did not ask for.
 *
 * So these tests pin two things:
 *
 * 1. An `execution-only` brief carries the step and its acceptance criteria,
 *    and does **not** carry the run's goal, a plan, or a product's house
 *    rules. The absence is the feature, so it is asserted directly.
 * 2. A `standard` brief is byte-for-byte what it was before relay existed.
 *    Existing `brain-hands` users get the same prompt they got yesterday.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { buildBrief, renderExecutionBrief, renderStandardBrief, MAX_BRIEF_CHARS } from "@agent2llm/execution";
import { renderTaskFor } from "@agent2llm/harness-cli-runtime";
import { createWorkBuddyHarness } from "@agent2llm/harness-workbuddy";
import { report } from "./_report.mjs";

const RELAY_TASK = {
  taskId: "a2lt_relay",
  iteration: 1,
  goal: "Make the whole product ready for a public launch, including docs, pricing and a migration guide",
  nextAction: "Fix Codex discovery so Agent2LLM detects ~/.codex/.sandbox-bin/codex.exe",
  acceptance: ["agent2llm detect shows Codex", "the real version is reported", "tests pass"],
  instructions: ["Fix Codex discovery"],
  workspaceRoot: "D:\\work",
  executionMode: "execution-only",
  cleanExecution: true,
  documentation: "if-required",
};

test("execution-policy", "an execution-only brief carries the step and its acceptance", () => {
  const brief = renderExecutionBrief(RELAY_TASK);

  assert(brief.includes("EXECUTION-ONLY MODE"), "the mode is stated first, where a model reads it");
  assert(brief.includes("NEXT ACTION"), "the step has its own section");
  assert(brief.includes(RELAY_TASK.nextAction), "the step is carried verbatim");
  assert(brief.includes("ACCEPTANCE"), "acceptance has its own section");
  for (const criterion of RELAY_TASK.acceptance) {
    assert(brief.includes(criterion), `acceptance criterion must survive: ${criterion}`);
  }
});

test("execution-policy", "an execution-only brief does not carry the run's goal", () => {
  const brief = renderExecutionBrief(RELAY_TASK);

  // The Brain holds the long-term plan. Re-stating it is an invitation to
  // re-plan, which is the duplicated work this mode exists to remove.
  assert(!brief.includes(RELAY_TASK.goal), "the run goal must not be sent to the harness");
  assert(!/^Goal:/m.test(brief), "the brief must not open with a goal");
  assert(!/^Steps:$/m.test(brief), "the brief must not present a step list to re-plan against");
});

test("execution-policy", "the banned outputs are named, because naming them is what works", () => {
  const brief = renderExecutionBrief(RELAY_TASK);
  for (const banned of [
    "do not re-plan the whole task",
    "do not produce implementation plans",
    "do not create progress reports",
    "do not create summary markdown files",
    "do not create phase reports",
    "do not create completion reports",
    "do not duplicate the Brain's reasoning",
  ]) {
    assert(brief.includes(banned), `the brief must state: ${banned}`);
  }
});

test("execution-policy", "the documentation clause follows the policy", () => {
  const required = renderExecutionBrief(RELAY_TASK);
  assert(
    required.includes("documentation may only be created if explicitly required by the task"),
    "the default allows documentation only when the task requires it"
  );

  const never = renderExecutionBrief({ ...RELAY_TASK, documentation: "never" });
  assert(never.includes("do not create or modify documentation files"), "never means never");
  assert(!never.includes("may only be created if explicitly required"), "the two clauses are exclusive");
});

test("execution-policy", "a product's house rules do not survive into a relay brief", () => {
  const workbuddy = createWorkBuddyHarness();

  const relay = renderTaskFor(workbuddy, RELAY_TASK);
  assert(
    !/Report what you changed and the test result at the end/.test(relay),
    "WorkBuddy's 'report at the end' rule is the opposite of clean execution and must be dropped"
  );

  // ...but it is still there for the workflow it was written for.
  const legacy = renderTaskFor(workbuddy, { ...RELAY_TASK, executionMode: "standard" });
  assert(
    /Report what you changed and the test result at the end/.test(legacy),
    "the legacy brain-hands prompt must keep WorkBuddy's house rule"
  );
});

test("execution-policy", "a standard brief is byte-identical to the pre-relay rendering", () => {
  const standard = renderStandardBrief({ ...RELAY_TASK, executionMode: "standard" });
  const expected = [
    `Goal: ${RELAY_TASK.goal}`,
    "",
    "Steps:",
    "1. Fix Codex discovery",
  ].join("\n");

  assertEqual(standard, expected, "the legacy brief text must not drift");
  assertEqual(
    renderExecutionBrief({ ...RELAY_TASK, executionMode: "standard" }),
    expected,
    "the dispatcher must route standard tasks to the legacy renderer"
  );
  // Absent executionMode is the legacy case: old callers keep old behaviour.
  assertEqual(
    renderExecutionBrief({ ...RELAY_TASK, executionMode: undefined }),
    expected,
    "a request with no executionMode keeps the legacy brief"
  );
});

test("execution-policy", "a runaway brief is capped, and says that it was capped", () => {
  const huge = renderExecutionBrief({
    ...RELAY_TASK,
    nextAction: "x".repeat(MAX_BRIEF_CHARS * 2),
    acceptance: Array.from({ length: 12 }, (_, index) => "criterion ".repeat(40) + index),
  });

  const capped = buildBrief({ ...RELAY_TASK, nextAction: "x".repeat(MAX_BRIEF_CHARS * 2) });
  assertEqual(capped.truncated, true, "an over-long brief reports that it was cut");
  assertEqual(capped.text.length, MAX_BRIEF_CHARS, "the ceiling is enforced exactly");
  assert(huge.length > MAX_BRIEF_CHARS, "buildBrief is what enforces the ceiling, not the renderer");

  const fine = buildBrief(RELAY_TASK);
  assertEqual(fine.truncated, false, "a normal brief is not truncated");
  assert(fine.bytes > 0, "the byte size is measured for the run metrics");
});

test("execution-policy", "a relay brief is small enough to be worth sending", () => {
  const brief = renderExecutionBrief(RELAY_TASK);
  // The instruction side of a dispatch is not where the tokens go — but only
  // while it stays this size. A regression that starts appending history would
  // show up here rather than in someone's bill.
  assert(
    brief.length < 1600,
    `a relay brief must stay small, got ${brief.length} characters`
  );
});

await report();
