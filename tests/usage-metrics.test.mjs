/**
 * Usage metrics.
 *
 * The Brain is the only side that spends tokens, so its turns are what the
 * report prints. These tests cover the phase mapping (state -> what the model
 * spent tokens on), the JSONL round-trip, aggregation, the estimate rule,
 * and the guarantee that metrics can never fail a run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assertEqual } from "@agent2llm/testing";
import {
  estimateTokens,
  phaseForState,
  readAllUsage,
  readSessionUsage,
  recordBrainUsage,
  summarizeUsage,
} from "@agent2llm/metrics";
import { report } from "./_report.mjs";

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

await report();
