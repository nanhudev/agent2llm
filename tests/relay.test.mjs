/**
 * Relay Mode: one Brain conversation, many one-step dispatches.
 *
 * These tests use a mock Brain on purpose — scripting a Brain is the only way
 * to assert *what it was sent* — but the execution side is not mocked. The
 * harness here really creates a file in a real git repository, so the evidence
 * the Brain receives is read from disk by the same collector that production
 * uses. A mocked evidence path would test the mock.
 *
 * The claims under test:
 *
 *   1. The Harness gets the next step and not the run's goal.
 *   2. The Brain's conversation survives from one run to the next.
 *   3. The evidence is verified against the repository, not accepted from the
 *      Harness.
 *   4. No token number is invented for a Brain that reports none.
 *   5. The Brain's `DONE` is a claim, not the run status — a run whose every
 *      execution failed is reported `blocked`, not `done`.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { BaseHarnessAdapter } from "@agent2llm/adapter-sdk";
import { emptyManifest, withCapabilities } from "@agent2llm/protocol";
import { RelayRunner } from "@agent2llm/orchestrator";
import { renderExecutionBrief } from "@agent2llm/execution";
import { PairStore, RunStore, createPair, pairIdentity } from "@agent2llm/pairs";
import { createMockBrain } from "@agent2llm/brain-mock";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { discardScratch, scratchDir } from "./_scratch.mjs";
import { report } from "./_report.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

/** A real repository, because the evidence has to be real. */
function repo() {
  const root = scratchDir("a2l-relay-repo");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@agent2llm.local");
  git(root, "config", "user.name", "Agent2LLM Test");
  git(root, "config", "commit.gpgsign", "false");
  // The scratch repository is on a drive whose checkout wants CRLF; without
  // this every fixture would print a line-ending warning.
  git(root, "config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "initial");
  return root;
}

/**
 * A harness that does what it was told, literally.
 *
 * `nextAction` is treated as a line of the form `<path> :: <content>` so the
 * test can name a file and its contents. Everything else — the exit code, the
 * changed-file list, the test line — is reported the way a real harness would
 * report it, including the option to over-report it.
 *
 * `fail` makes it fail the way a real harness fails when its own quota runs
 * out: an error code, a message, and a working tree that did not move.
 */
class WritingHarness extends BaseHarnessAdapter {
  briefs = [];
  constructor(options = {}) {
    super();
    this.root = options.root;
    this.overReport = options.overReport ?? false;
    this.fail = options.fail ?? null;
  }

  metadata() {
    return { id: "writing-harness", name: "Writing Harness", version: "0.1.0", role: "harness", experimental: false };
  }

  async detect() {
    return { status: "verified", version: "0.1.0", reason: "In-process test harness." };
  }

  async buildCapabilities() {
    return withCapabilities(emptyManifest("in-process"), [
      "session.create",
      "session.attach",
      "workspace.write",
      "shell.execute",
      "task.execute",
      "stream.events",
      "supportsHeadless",
    ]);
  }

  async createSession(ctx) {
    return { id: `writing-${ctx.sessionId}`, adapterId: "writing-harness", ref: { sessionId: ctx.sessionId } };
  }

  async attachSession(checkpoint) {
    return {
      id: String(checkpoint.ref.sessionId ?? "writing"),
      adapterId: "writing-harness",
      ref: checkpoint.ref,
    };
  }

  async execute(_session, task) {
    // Recorded the way a real harness consumes it: the request, and the brief
    // rendered from it by the shared renderer.
    this.briefs.push({ request: task, brief: renderExecutionBrief(task) });
    return { id: `writing-exec-${task.iteration}`, adapterId: "writing-harness", ref: {} };
  }

  async *events(handle) {
    const task = this.briefs[this.briefs.length - 1].request;
    const [target, content] = String(task.nextAction ?? "").split(" :: ");
    const written = [];
    if (!this.fail && target && content !== undefined) {
      const full = path.join(this.root, target);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `${content}\n`);
      written.push(target);
    }
    yield { type: "started", at: new Date().toISOString(), handleId: handle.id };
    if (this.fail) {
      // A failed execution is data, not an exception: this is how the quota
      // wall behind the real-Codex E2E presented itself.
      yield {
        type: "failed",
        at: new Date().toISOString(),
        error: { code: "harness_unavailable", message: this.fail },
      };
      return;
    }
    yield {
      type: "completed",
      at: new Date().toISOString(),
      result: {
        ok: true,
        exitStatus: "ok",
        changedFiles: this.overReport && written.length === 0 ? ["src/ghost.ts"] : written,
        tests: "7 passed",
        summary: "Wrote the requested file.",
        commands: ["npm test"],
        durationMs: 3,
      },
    };
  }

  async cancel() {}
  async close() {}
}

function setup(options = {}) {
  const root = options.root ?? repo();
  const stateDir = scratchDir("a2l-relay-state");
  const registry = new AdapterRegistry();
  // No script at all when the test did not ask for one, so the Brain falls back
  // to the plan its workflow needs. An empty array is not the same thing: it is
  // an explicit plan with no steps in it, and the mock now refuses one.
  const brain = createMockBrain(options.script ? { script: options.script } : {});
  const harness = new WritingHarness({ root, overReport: options.overReport, fail: options.fail });
  registry.registerAll([brain, harness]);

  const pairs = new PairStore(path.join(stateDir, "pairs"));
  const runs = new RunStore(path.join(stateDir, "runs"));
  pairs.save(
    createPair({
      pairId: "a2lp_relay",
      brainAdapterId: "mock-brain",
      harnessAdapterId: "writing-harness",
      contextMode: "harness-owned",
    })
  );

  const events = [];
  const runner = new RelayRunner({ registry, pairs, runs, emit: (event) => events.push(event) });
  const context = { id: "ctx_test", root, source: "harness", detail: {} };
  return { root, pairs, runs, brain, harness, runner, events, context };
}

/** A step that writes one file. `seq` keeps the two runs distinguishable. */
function writeStep(name, content) {
  return { type: "NEXT_ACTION", task: `src/${name} :: export const x = ${content};`, acceptance: ["file exists"] };
}

test("relay", "the harness gets the next step and never the run's goal", async () => {
  const ctx = setup({
    script: [writeStep("one.ts", 1), { type: "DONE", summary: "wrote one.ts" }],
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_goal",
      goal: "Rewrite the whole authentication subsystem",
      context: ctx.context,
    });

    assertEqual(result.status, "done", `expected done, got ${result.status}: ${result.summary}`);
    const { request, brief } = ctx.harness.briefs[0];
    assertEqual(request.executionMode, "execution-only", "the dispatch is an execution-only dispatch");
    assertEqual(request.nextAction, "src/one.ts :: export const x = 1;", "the step is delivered verbatim");
    assertEqual(request.acceptance[0], "file exists", "acceptance travels with the step");

    // The whole point of the mode: the goal is in the request, because the
    // standard renderer needs it, and *not* in the text the harness reads.
    assert(brief.includes("EXECUTION-ONLY MODE"), `the mode is stated: ${brief}`);
    assert(brief.includes("NEXT ACTION"), "with the step");
    assert(brief.includes("src/one.ts :: export const x = 1;"), "delivered verbatim");
    assert(
      !brief.includes("authentication"),
      `the run's goal must not reach the harness, got: ${brief}`
    );
    assert(
      !brief.includes("Implement the change"),
      "and neither does any plan the Brain did not restate"
    );
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "an unscripted Brain gets a Relay plan, not the brain-hands one", async () => {
  // Nothing is scripted anywhere: this is the zero-setup path a new user takes,
  // and it is the one the dock's Run button used to fail on. A Relay run driven
  // by the brain-hands plan ends `blocked` with "the Brain sent PLAN where a
  // next step or a verdict was expected", so reaching `done` at all *is* the
  // assertion — the default plan followed the workflow the INIT declared.
  const ctx = setup();
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_default",
      goal: "prove the default plan belongs to the declared workflow",
      context: ctx.context,
    });

    assertEqual(result.status, "done", `expected done, got ${result.status}: ${result.summary}`);
    assertEqual(ctx.harness.briefs.length, 1, "the Brain named exactly one next step");
    assertEqual(
      ctx.harness.briefs[0].request.executionMode,
      "execution-only",
      "and it was dispatched as a Relay step, not as a goal"
    );
    // The default step names no file, so this fixture writes nothing — and that
    // is recorded as nothing changed rather than counted as work done.
    assertEqual(result.metrics.filesChanged, 0, "a step that wrote nothing changed no files");
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "the same Brain conversation serves a second run", async () => {
  const ctx = setup({
    script: [
      writeStep("first.ts", 1),
      { type: "DONE", summary: "run one done" },
      // If the conversation is reused the cursor is already past the steps
      // above, so this is the third reply the pair ever produces.
      writeStep("second.ts", 2),
      { type: "DONE", summary: "run two done" },
    ],
  });
  try {
    const pair = () => ctx.pairs.get("a2lp_relay");
    const first = await ctx.runner.run({
      pair: pair(),
      runId: "a2lr_one",
      goal: "first goal",
      context: ctx.context,
    });
    assertEqual(first.status, "done");
    assertEqual(first.conversation.reused, false, "the first run opens the conversation");

    const second = await ctx.runner.run({
      pair: pair(),
      runId: "a2lr_two",
      goal: "second goal",
      context: ctx.context,
    });

    assertEqual(second.status, "done", `second run: ${second.summary}`);
    assertEqual(second.conversation.outcome, "attached", "the second run attaches to the same conversation");
    assertEqual(second.conversation.reused, true, "and it is reported as reused");

    // The proof that it is one conversation: the Brain's script advanced
    // instead of restarting, so run two acted on the step after run one's.
    assertEqual(ctx.harness.briefs.length, 2, "two runs, two dispatches");
    assertEqual(ctx.harness.briefs[1].request.nextAction, "src/second.ts :: export const x = 2;");

    const saved = pair();
    assert(saved.brainRef, "the pair stored the conversation pointer");
    assertEqual(saved.brainRef.adapterId, "mock-brain", "and the pointer belongs to the Brain adapter");
    assert(saved.lastRunAt, "the pair records when it last ran");
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "evidence is read from the repository, not from the harness", async () => {
  const ctx = setup({
    script: [writeStep("verified.ts", 9), { type: "DONE", summary: "done" }],
  });
  try {
    await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_evidence",
      goal: "write a file",
      context: ctx.context,
    });

    const sent = ctx.brain.sentMessages("a2ls_a2lp_relay");
    const executed = sent.filter((message) => message.type === "EXECUTED");
    assertEqual(executed.length, 1, "the Brain received one execution report");
    assert(
      executed[0].payload.evidence.includes("src/verified.ts"),
      `the compact evidence names the file git confirms: ${executed[0].payload.evidence}`
    );
    assert(
      executed[0].payload.evidence.includes("verified by git"),
      "and it says where the list came from"
    );
    assert(
      executed[0].payload.evidence.includes("corroborated"),
      `the verdict is stated: ${executed[0].payload.evidence}`
    );
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "a harness that claims an untouched file is contradicted, not believed", async () => {
  const ctx = setup({
    // The step names nothing to write, so nothing changes — and the harness
    // reports a file anyway. That is the lie the collector exists to catch.
    script: [
      { type: "NEXT_ACTION", task: "inspect only", acceptance: [] },
      { type: "DONE", summary: "all good" },
    ],
    overReport: true,
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_lie",
      goal: "claim a change that did not happen",
      context: ctx.context,
    });

    const sent = ctx.brain.sentMessages("a2ls_a2lp_relay").filter((m) => m.type === "EXECUTED");
    assert(
      sent[0].payload.evidence.includes("contradicted"),
      `the contradiction must be reported: ${sent[0].payload.evidence}`
    );
    // The Brain said DONE, and the run still does not claim success: the
    // status follows the repository, not the acceptance.
    assertEqual(result.status, "blocked", `expected blocked, got ${result.status}`);
    assert(/contradicts/i.test(result.summary), `the summary must say why: ${result.summary}`);
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "a Brain that calls it done over a failed execution is blocked, not done", async () => {
  const ctx = setup({
    // The step cannot run: the harness fails the way a real one fails when its
    // own quota runs out — an error message, and a working tree that did not
    // move. The Brain, seeing a failure it cannot fix, still says DONE.
    script: [writeStep("never.ts", 1), { type: "DONE", summary: "nothing left to do" }],
    fail: "unexpected status 403 Forbidden",
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_failed",
      goal: "run a step that cannot run",
      context: ctx.context,
    });

    // Before the rule this was `done` with exit code 0, which reads as "the
    // work exists". It does not.
    assertEqual(result.status, "blocked", `expected blocked, got ${result.status}: ${result.summary}`);
    assert(
      /all 1 execution\(s\) failed/i.test(result.summary),
      `the summary must say why: ${result.summary}`
    );
    assert(result.summary.includes("403"), `and repeat what the harness said: ${result.summary}`);

    // The Brain really did say DONE — this is not "the Brain objected", it is
    // "the Brain stopped and the record disagrees".
    const sent = ctx.brain.sentMessages("a2ls_a2lp_relay");
    assert(sent.some((message) => message.type === "EXECUTED"), "the Brain was told about the failure");

    const saved = ctx.runs.get("a2lr_failed");
    assertEqual(saved.receipts.length, 1, "the failed execution is on the record");
    assertEqual(saved.receipts[0].status, "failure", "and recorded as a failure, not a success");
    assertEqual(saved.metrics.filesChanged, 0, "nothing changed on disk");
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "a Brain may ask for one file's diff and gets it from the repository", async () => {
  const ctx = setup({
    script: [
      writeStep("asked.ts", 3),
      // A plain web Brain does exactly this: it writes the instruction the
      // compact evidence gave it.
      { type: "NEXT_ACTION", task: "SHOW_DIFF src/asked.ts", acceptance: [] },
      { type: "DONE", summary: "seen" },
    ],
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_detail",
      goal: "write, then look at what was written",
      context: ctx.context,
    });
    assertEqual(result.status, "done", result.summary);

    const sent = ctx.brain.sentMessages("a2ls_a2lp_relay");
    const detail = sent.filter((message) => message.type === "EVIDENCE_DETAIL");
    assertEqual(detail.length, 1, "exactly one detail was answered");
    assertEqual(detail[0].payload.file, "src/asked.ts");
    assert(
      detail[0].payload.detail.includes("export const x = 3;"),
      `the diff is real and read from the repository: ${detail[0].payload.detail}`
    );
    assertEqual(ctx.harness.briefs.length, 1, "asking to look is not an execution");
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "a web Brain's silence about tokens is recorded as unknown, never guessed", async () => {
  const ctx = setup({
    script: [writeStep("metrics.ts", 4), { type: "DONE", summary: "done" }],
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_metrics",
      goal: "count without inventing",
      context: ctx.context,
    });

    assertEqual(result.metrics.brainTokens.source, "unavailable", "no provider reported usage here");
    assert(result.metrics.brainTokens.reason.includes("mock-brain"), "and the reason names the adapter");

    // Real, measured numbers are still reported — just not as tokens.
    assert(result.metrics.brainTurns >= 2, `brain turns were counted: ${result.metrics.brainTurns}`);
    assertEqual(result.metrics.harnessRuns, 1, "one harness execution");
    assertEqual(result.metrics.testsPassed, 7, "the test count the harness reported");
    assert(result.metrics.harnessInstruction.bytes > 0, "the brief was measured");
    assert(result.metrics.evidenceRaw.bytes > 0, "the raw evidence was measured");
    assert(
      result.metrics.evidenceCompact.bytes <= result.metrics.evidenceRaw.bytes,
      "the compact form is not larger than the raw record"
    );
    assertEqual(result.metrics.filesChanged, 1, "the changed file came from git");
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "a REVISE is the next step, not a re-plan", async () => {
  const ctx = setup({
    script: [
      writeStep("v1.ts", 1),
      { type: "REVISE", reason: "the value is wrong", requiredChanges: ["src/v1.ts :: export const x = 2;"] },
      { type: "DONE", summary: "corrected" },
    ],
  });
  try {
    const result = await ctx.runner.run({
      pair: ctx.pairs.get("a2lp_relay"),
      runId: "a2lr_revise",
      goal: "get the value right",
      context: ctx.context,
    });
    assertEqual(result.status, "done", result.summary);
    assertEqual(result.iterations, 2, "a revision runs a second execution");
    assertEqual(result.metrics.revisions, 1, "and the revision is counted");
    assert(
      ctx.harness.briefs[1].request.nextAction.includes("export const x = 2;"),
      "the revision became the next action verbatim"
    );
    assertEqual(
      fs.readFileSync(path.join(ctx.root, "src", "v1.ts"), "utf8").trim(),
      "export const x = 2;",
      "the correction actually landed on disk"
    );
  } finally {
    discardScratch(ctx.root);
  }
});

test("relay", "duplicate pairs are distinguished by context, not by id", async () => {
  const a = createPair({ pairId: "a2lp_a", brainAdapterId: "mock-brain", harnessAdapterId: "writing-harness" });
  const b = createPair({ pairId: "a2lp_b", brainAdapterId: "mock-brain", harnessAdapterId: "writing-harness" });
  const otherContext = { id: "ctx_other", source: "harness", detail: {} };

  assertEqual(pairIdentity(a), pairIdentity(b), "same brain, same harness, no context: one identity");
  assert(
    pairIdentity({ ...a, context: otherContext }) !== pairIdentity(a),
    "the same harness in a second context is a second pair"
  );
});

test("relay", "without a context the run refuses rather than guessing a folder", async () => {
  const ctx = setup({ script: [{ type: "DONE", summary: "unreachable" }] });
  try {
    let failed = null;
    try {
      await ctx.runner.run({
        pair: ctx.pairs.get("a2lp_relay"),
        runId: "a2lr_nocontext",
        goal: "run with nowhere to run",
        context: null,
      });
    } catch (error) {
      failed = error;
    }
    assert(failed, "the run must not start");
    assertEqual(failed.code, "WorkspaceViolation", "and it must be classified");
    assert(/--workspace/.test(failed.hint ?? ""), `the hint names the way out: ${failed.hint}`);
    assertEqual(ctx.harness.briefs.length, 0, "nothing was executed");
  } finally {
    discardScratch(ctx.root);
  }
});

report("relay");
