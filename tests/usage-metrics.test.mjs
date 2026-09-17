/**
 * Usage metrics.
 *
 * The Brain's provider usage is the only usage Agent2LLM can measure, so that
 * is what the report prints — and what it deliberately does not print is a
 * harness figure, because a harness's own model spend is not observable from
 * outside. These tests cover the phase mapping (state -> what the model spent
 * tokens on), the JSONL round-trip, aggregation, the estimate rule, the
 * guarantee that metrics can never fail a run, and the rule that an
 * unreported figure is shown as unknown rather than as zero.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import {
  estimateTokens,
  phaseForState,
  readAllUsage,
  readSessionUsage,
  recordBrainUsage,
  summarizeUsage,
} from "@agent2llm/metrics";
import { emptyRunMetrics } from "@agent2llm/pairs";
import { report } from "./_report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "apps", "cli", "dist", "index.js");

const FIXTURE_STATE = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-usage-"));
const STATE_A = path.join(FIXTURE_STATE, "a");
const STATE_B = path.join(FIXTURE_STATE, "b");

function use(dir) {
  process.env.AGENT2LLM_STATE_DIR = dir;
}

function entry(overrides = {}) {
  return {
    sessionId: "s1",
    brainId: "api",
    phase: "plan",
    promptTokens: 100,
    completionTokens: 40,
    model: "test-model",
    timestamp: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

test("usage-metrics", "A2L states map onto the phase the model spent tokens on", () => {
  assertEqual(phaseForState("INIT"), "inspect");
  assertEqual(phaseForState("INSPECTING"), "inspect");
  assertEqual(phaseForState("PLAN"), "plan");
  assertEqual(phaseForState("EXECUTED"), "review");
  assertEqual(phaseForState("REVIEWING"), "review");
  assertEqual(phaseForState("REVISE"), "revise");
  assertEqual(phaseForState("DISPATCHED"), "other");
});

test("usage-metrics", "records round-trip through JSONL", () => {
  use(STATE_A);
  recordBrainUsage(entry({ promptTokens: 1200, completionTokens: 300 }));
  const read = readSessionUsage("s1");
  assertEqual(read.length, 1);
  assertEqual(read[0].phase, "plan");
  assertEqual(read[0].promptTokens, 1200);
  assertEqual(read[0].completionTokens, 300);
  assertEqual(read[0].model, "test-model");
});

test("usage-metrics", "readAllUsage lists every session that has entries", () => {
  use(STATE_A);
  recordBrainUsage(entry({ sessionId: "s2", phase: "review" }));
  const all = readAllUsage().map((s) => s.sessionId).sort();
  assertEqual(all.join(","), "s1,s2");
});

test("usage-metrics", "summarizeUsage aggregates turns, tokens and phases", () => {
  const sessions = [
    {
      entries: [
        entry({ phase: "inspect", promptTokens: 100, completionTokens: 50 }),
        entry({ phase: "plan", promptTokens: 200, completionTokens: 80 }),
      ],
    },
    { entries: [entry({ phase: "review", promptTokens: 400, completionTokens: 120 })] },
  ];
  const summary = summarizeUsage(sessions);
  assertEqual(summary.sessions, 2);
  assertEqual(summary.turns, 3);
  assertEqual(summary.promptTokens, 700);
  assertEqual(summary.completionTokens, 250);
  assertEqual(summary.phases.inspect, 1);
  assertEqual(summary.phases.plan, 1);
  assertEqual(summary.phases.review, 1);
  assertEqual(summary.phases.revise, 0);
  assertEqual(summary.brains.join(","), "api");
});

test("usage-metrics", "estimateTokens counts CJK per character and ASCII four per token", () => {
  assertEqual(estimateTokens(""), 0);
  assertEqual(estimateTokens("abcd"), 1);
  assertEqual(estimateTokens("abc"), 1);
  assertEqual(estimateTokens("你好"), 2);
  assertEqual(estimateTokens("你好abcd"), 3);
});

test("usage-metrics", "recording never fails a run when the state directory is unusable", () => {
  use(path.join(FIXTURE_STATE, "not", "writable", "\u0000"));
  // Must not throw: metrics are best-effort by design.
  recordBrainUsage(entry({ sessionId: "s3" }));
  use(STATE_B);
  assertEqual(readSessionUsage("s3").length, 0);
});

test("usage-metrics", "empty sessions are not listed", () => {
  use(STATE_B);
  assertEqual(readAllUsage().length, 0);
});

test("usage-metrics", "harness model usage is an unknown, not a zero", () => {
  // A harness (Codex, Cursor, Claude Code) may spend its own model budget
  // while it executes, and Agent2LLM cannot observe that from outside. The
  // metric therefore starts unreported, and the report has to say so.
  const metrics = emptyRunMetrics();
  assertEqual(metrics.harnessUsage, null, "nothing reported means unreported");
  assertEqual(metrics.brainTokens, null, "and the Brain's side behaves the same way");
});

test("usage-metrics", "the report never converts unreported harness usage into a figure", () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-report-"));
  use(state);
  // A session with recorded Brain usage, so the report prints its full body
  // rather than returning early on "no usage recorded yet".
  recordBrainUsage(entry({ sessionId: "s-report" }));
  const result = spawnSync(process.execPath, [CLI, "report"], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: state, NO_COLOR: "1" },
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assertEqual(result.status, 0, `report must run: ${out.slice(-400)}`);
  assert(!/0 brain tokens/.test(out), `the old false claim is gone, got: ${out}`);
  assert(!/never consults a model/.test(out), `and no implication of structural zero: ${out}`);
  assert(/Harness usage is not shown/.test(out), "it names what is missing instead");
  assert(/unknown, not zero/.test(out), `and states the difference: ${out}`);
});

await report();
