import { spawnSync } from "node:child_process";
import { compareRuns, createRunRecord, RunStore } from "@agent2llm/pairs";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

function run(id, overrides = {}) {
  const r = createRunRecord({ runId: id, pairId: "pair", goal: "private task", context: { id: "private", root: "/private/path", source: "user" } });
  r.status = "done"; r.finishedAt = new Date().toISOString(); r.metrics.testsPassed = 4;
  r.metrics.elapsedMs = 100; r.metrics.harnessInstruction.bytes = 400;
  r.receipts = [{ receiptId: "receipt", runId: id, iteration: 0, status: "success", at: r.finishedAt }];
  return { ...r, ...overrides };
}

test("compare", "unknown harness usage never becomes token savings", () => {
  const a = run("a"), b = run("b");
  a.metrics.brainTokens = { source: "provider-reported", promptTokens: 10, completionTokens: 20 };
  b.metrics.elapsedMs = 50;
  const result = compareRuns(a, b);
  assert(result.comparable); assertEqual(result.delta.elapsedMs, -50);
  assertEqual(result.delta.totalProviderTokens, null);
  const shared = JSON.stringify(result);
  assert(!shared.includes("private task")); assert(!shared.includes("/private/path"));
});
test("compare", "counts totals only when both sides report provider usage", () => {
  const a = run("a"), b = run("b");
  for (const r of [a,b]) {
    r.metrics.brainTokens = { source: "provider-reported", promptTokens: 10, completionTokens: 20 };
    r.metrics.harnessUsage = { source: "provider-reported", promptTokens: 0, completionTokens: 0 };
  }
  assertEqual(compareRuns(a,b).delta.totalProviderTokens, 0);
});
test("compare", "rejects different goals, incomplete evidence, failures and self comparison", () => {
  assert(!compareRuns(run("a"),run("b",{goal:"other"})).comparable);
  assert(!compareRuns(run("a"),run("b",{status:"blocked"})).comparable);
  assert(!compareRuns(run("a"),run("b",{receipts:[]})).comparable);
  const b=run("b"); b.metrics.testsPassed=null;
  assert(!compareRuns(run("a"),b).comparable);
  assert(!compareRuns(run("a"),run("a")).comparable);
});
test("compare", "CLI exports saved observations and refuses missing or unsafe IDs", () => {
  const store=new RunStore(); store.save(run("baseline")); store.save(run("candidate"));
  const cli=(args)=>spawnSync(process.execPath,["apps/cli/dist/index.js","compare",...args],{encoding:"utf8"});
  const result=cli(["baseline","candidate","--json"]);
  assertEqual(result.status,0); assert(JSON.parse(result.stdout).comparable);
  assertEqual(cli(["baseline","missing"]).status,2);
  assertEqual(cli(["../bad","candidate"]).status,2);
});
await report();
