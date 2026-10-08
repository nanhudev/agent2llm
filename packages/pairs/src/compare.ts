import { runRecordSchema, type RunRecord, type UsageAccounting } from "./model.js";

function totalUsage(brain: UsageAccounting | null, harness: UsageAccounting | null): number | null {
  if (brain?.source !== "provider-reported" || harness?.source !== "provider-reported") return null;
  return brain.promptTokens + brain.completionTokens + harness.promptTokens + harness.completionTokens;
}

/** Descriptive comparison only: matching goals cannot establish a controlled experiment. */
export function compareRuns(baselineInput: RunRecord, candidateInput: RunRecord) {
  const baseline = runRecordSchema.parse(baselineInput);
  const candidate = runRecordSchema.parse(candidateInput);
  const issues: string[] = [];
  if (baseline.runId === candidate.runId) issues.push("Choose two different runs.");
  if (baseline.goal.trim() !== candidate.goal.trim()) issues.push("Goals differ; compare the same task.");
  if ([baseline, candidate].some((r) => r.status !== "done" || !r.finishedAt)) issues.push("Both runs must finish successfully.");
  if ([baseline, candidate].some((r) => !r.receipts.length || r.receipts.some((s) => s.status !== "success"))) {
    issues.push("Successful execution receipts are required for both runs.");
  }
  if ([baseline, candidate].some((r) => r.metrics.testsPassed === null)) issues.push("Test pass counts are unavailable for at least one run.");
  const observed = (run: RunRecord) => ({
    runId: run.runId, workflow: run.workflowId, status: run.status,
    elapsedMs: run.metrics.elapsedMs, brainTurns: run.metrics.brainTurns,
    harnessRuns: run.metrics.harnessRuns, testsPassed: run.metrics.testsPassed,
    instructionBytes: run.metrics.harnessInstruction.bytes,
    evidenceRawBytes: run.metrics.evidenceRaw.bytes,
    evidenceCompactBytes: run.metrics.evidenceCompact.bytes,
    totalProviderTokens: totalUsage(run.metrics.brainTokens, run.metrics.harnessUsage),
  });
  const a = observed(baseline), b = observed(candidate);
  const comparable = issues.length === 0;
  return {
    schemaVersion: 1, comparable, issues, baseline: a, candidate: b,
    delta: comparable ? {
      elapsedMs: b.elapsedMs - a.elapsedMs,
      instructionBytes: b.instructionBytes - a.instructionBytes,
      brainTurns: b.brainTurns - a.brainTurns,
      totalProviderTokens: a.totalProviderTokens !== null && b.totalProviderTokens !== null
        ? b.totalProviderTokens - a.totalProviderTokens : null,
    } : null,
    limitations: [
      "Stored receipts and pass counts are observations, not independent task-correctness proof.",
      "Unknown provider usage stays null; instruction bytes are not billed tokens.",
      "Control model, task, starting commit and acceptance tests; repeat trials before claiming an improvement.",
      "This comparison omits goals, workspace paths, prompts and receipt content for sharing.",
    ],
  };
}
