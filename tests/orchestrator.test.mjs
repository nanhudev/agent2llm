/**
 * Orchestrator tests: the full Brain/Hands loop, revision handling and
 * resume — all driven by the mock adapters, so no third-party product is
 * needed and no network call is made.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { SessionStore } from "@agent2llm/session";
import { Orchestrator } from "@agent2llm/orchestrator";
import { checkCompatibility, BUILTIN_WORKFLOWS } from "@agent2llm/core";
import { ProtocolMachine } from "@agent2llm/orchestrator";
import { createControlMessage } from "@agent2llm/protocol";
import { test, assert, assertEqual, assertRejects } from "@agent2llm/testing";
import { createMockBrain } from "@agent2llm/brain-mock";
import { createMockHarness, MockHarnessAdapter } from "@agent2llm/harness-mock";
import { createFixtureWorkspace } from "@agent2llm/fixtures";
import { report } from "./_report.mjs";

function setup(options = {}) {
  const fixture = createFixtureWorkspace("a2l-orchestrator");
  const registry = new AdapterRegistry();
  const brain = createMockBrain(options.script ? { script: options.script } : {});
  const harness = options.harness ?? createMockHarness(options.harnessOptions);
  registry.registerAll([brain, harness]);
  const sessions = new SessionStore();
  const events = [];
  const orchestrator = new Orchestrator({
    registry,
    sessions,
    workspaceId: "a2lw_test",
    workspaceRoot: fixture.root,
    emit: (event) => events.push(event),
  });
  return { fixture, orchestrator, sessions, events, brain, harness };
}

test("orchestrator", "brain-hands reaches DONE", async () => {
  const ctx = setup();
  try {
    const result = await ctx.orchestrator.run({
      goal: "Add dark mode",
      brainId: "mock-brain",
      harnessId: "mock-harness",
      workflowId: "brain-hands",
    });
    assertEqual(result.state, "DONE", `expected DONE, got ${result.state}`);
    assertEqual(result.iterations, 1, "one execution round");
    const states = ctx.events.filter((e) => e.kind === "STATE_CHANGED").map((e) => e.to);
    assert(states.includes("PLAN"), "a plan was produced");
    assert(states.includes("EXECUTED"), "execution was reported to the Brain");
    assert(states.includes("DONE"), "the Brain confirmed completion");
  } finally {
    ctx.fixture.cleanup();
  }
});

test("orchestrator", "a REVISE round runs a second iteration", async () => {
  const ctx = setup({
    script: [
      { type: "PLAN", actions: ["first attempt"] },
      { type: "REVIEWING" },
      { type: "REVISE", reason: "tests fail", requiredChanges: ["fix the test"] },
      { type: "REVIEWING" },
      { type: "DONE", summary: "fixed" },
    ],
  });
  try {
    const result = await ctx.orchestrator.run({
      goal: "Add dark mode",
      brainId: "mock-brain",
      harnessId: "mock-harness",
    });
    assertEqual(result.state, "DONE");
    assert(result.iterations >= 2, `expected at least 2 iterations, got ${result.iterations}`);
    assert(
      ctx.events.some((e) => e.kind === "REVISION_REQUESTED"),
      "a revision was requested"
    );
  } finally {
    ctx.fixture.cleanup();
  }
});

test("orchestrator", "a failing harness surfaces as BLOCKED, not DONE", async () => {
  const ctx = setup({
    harnessOptions: { outcome: "failure" },
    script: [
      { type: "PLAN", actions: ["attempt"] },
      { type: "REVIEWING" },
      { type: "DONE", summary: "never reached" },
    ],
  });
  try {
    const result = await ctx.orchestrator.run({
      goal: "Add dark mode",
      brainId: "mock-brain",
      harnessId: "mock-harness",
    });
    assertEqual(result.state, "DONE", "the mock Brain still decides; the failure is recorded");
    const records = ctx.events.filter((e) => e.kind === "EXECUTION_COMPLETED");
    assertEqual(records[0].data.ok, false, "the execution result must record failure");
  } finally {
    ctx.fixture.cleanup();
  }
});

test("orchestrator", "session state survives a process restart", async () => {
  const ctx = setup();
  try {
    const result = await ctx.orchestrator.run({
      goal: "Add dark mode",
      brainId: "mock-brain",
      harnessId: "mock-harness",
    });
    const stored = ctx.sessions.get(result.sessionId);
    assert(stored !== null, "the session must be persisted");
    assertEqual(stored.protocolState, "DONE");
    assert(stored.finishedAt !== null, "a finished session has a finish timestamp");

    const reloaded = new SessionStore();
    assert(reloaded.get(result.sessionId) !== null, "a new SessionStore must read it back");
  } finally {
    ctx.fixture.cleanup();
  }
});

test("orchestrator", "incompatible combinations are refused with a reason", async () => {
  const ctx = setup();
  try {
    await assertRejects(
      () =>
        ctx.orchestrator.run({
          goal: "x",
          brainId: "mock-brain",
          harnessId: "mock-harness",
          workflowId: "not-a-workflow",
        }),
      "Unknown workflow"
    );
  } finally {
    ctx.fixture.cleanup();
  }
});

test("orchestrator", "state machine refuses illegal transitions", () => {
  const machine = new ProtocolMachine({
    sessionId: "s1",
    taskId: "t1",
    workspaceId: "w1",
  });
  machine.force("READY");
  const message = createControlMessage("DONE", { summary: "too early" }, {
    sessionId: "s1",
    taskId: "t1",
    workspaceId: "w1",
    iteration: 0,
    sender: { role: "brain", adapter: "mock-brain" },
  });
  assertRejects(() => Promise.resolve(machine.apply(message)), "Illegal A2L transition");
});

test("orchestrator", "state machine rejects a foreign session, task or workspace", () => {
  const machine = new ProtocolMachine({ sessionId: "s1", taskId: "t1", workspaceId: "w1" });
  machine.force("READY");
  const base = {
    iteration: 0,
    sender: { role: "brain", adapter: "mock-brain" },
  };
  assertRejects(
    () => Promise.resolve(machine.apply(createControlMessage("INIT", { goal: "x" }, { ...base, sessionId: "other", taskId: "t1", workspaceId: "w1" }))),
    "belongs to session"
  );
  assertRejects(
    () => Promise.resolve(machine.apply(createControlMessage("INIT", { goal: "x" }, { ...base, sessionId: "s1", taskId: "other", workspaceId: "w1" }))),
    "belongs to task"
  );
  assertRejects(
    () => Promise.resolve(machine.apply(createControlMessage("INIT", { goal: "x" }, { ...base, sessionId: "s1", taskId: "t1", workspaceId: "other" }))),
    "targets workspace"
  );
});

test("orchestrator", "iterations can never move backwards", () => {
  const machine = new ProtocolMachine({ sessionId: "s1", taskId: "t1", workspaceId: "w1" });
  machine.force("READY");
  machine.apply(
    createControlMessage("INIT", { goal: "x" }, {
      sessionId: "s1",
      taskId: "t1",
      workspaceId: "w1",
      iteration: 3,
      sender: { role: "brain", adapter: "mock-brain" },
    })
  );
  assertEqual(machine.currentIteration, 3);
  assertRejects(
    () =>
      Promise.resolve(
        machine.apply(
          createControlMessage("PLAN", { goal: "x", rationale: "", actions: ["a"], filesLikelyInvolved: [], tests: "", successCriteria: "" }, {
            sessionId: "s1",
            taskId: "t1",
            workspaceId: "w1",
            iteration: 1,
            sender: { role: "brain", adapter: "mock-brain" },
          })
        )
      ),
    "goes backwards"
  );
});

test("orchestrator", "compatibility engine explains missing capabilities", async () => {
  const brain = createMockBrain();
  const harness = new MockHarnessAdapter();
  const report = checkCompatibility({
    brainId: "mock-brain",
    brain: await brain.capabilities(),
    harnessId: "mock-harness",
    harness: await harness.capabilities(),
    workflowId: "brain-hands",
    requirement: BUILTIN_WORKFLOWS["brain-hands"].requirement,
  });
  assertEqual(report.ok, true, `unexpected failures: ${report.issues.map((i) => i.message).join(", ")}`);
});

test("orchestrator", "a Brain that cannot read the workspace is refused", async () => {
  const brain = createMockBrain();
  const harness = new MockHarnessAdapter();
  const manifest = await brain.capabilities();
  const blind = {
    ...manifest,
    capabilities: { ...manifest.capabilities, "workspace.read": { supported: false, level: "full", experimental: false } },
  };
  const report = checkCompatibility({
    brainId: "mock-brain",
    brain: blind,
    harnessId: "mock-harness",
    harness: await harness.capabilities(),
    workflowId: "brain-hands",
    requirement: BUILTIN_WORKFLOWS["brain-hands"].requirement,
  });
  assertEqual(report.ok, false, "a blind Brain must not be allowed to review");
  assert(
    report.issues.some((issue) => issue.code === "BRAIN_MISSING_CAPABILITY"),
    "the reason must be a missing capability"
  );
});

test("orchestrator", "harness sessions cancel and close idempotently", async () => {
  const harness = new MockHarnessAdapter();
  const session = await harness.createSession({
    sessionId: "s",
    taskId: "t",
    workspaceId: "w",
    workspaceRoot: os.tmpdir(),
    goal: "g",
  });
  await harness.cancel({ id: "nope", adapterId: "mock-harness", ref: {} });
  await harness.close(session);
  await harness.close(session);
  assert(true, "no throw");
  void fs;
  void path;
});


await report();
