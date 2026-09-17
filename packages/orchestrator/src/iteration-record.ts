/**
 * What an iteration leaves behind.
 *
 * The file list for the Brain and the local record for the next resume are the
 * same concern — a step that already happened — which is why they are one
 * module rather than two.
 */
import { appendExecutionRecord } from "@agent2llm/execution";
import { changedSinceLastSnapshot, type Workspace } from "@agent2llm/workspace";
import type { ExecutionOutcome } from "./execution.js";

/**
 * Prefers what the Harness reported, falls back to the local snapshot.
 *
 * The snapshot wins when the Harness reported nothing but files did change,
 * which is exactly the case a silent Harness would otherwise hide.
 */
export function resolveChangedFiles(workspace: Workspace, outcome: ExecutionOutcome): number | string[] {
  const reported = outcome.changedFiles;
  if (Array.isArray(reported) && reported.length > 0) return reported;
  const changed = changedSinceLastSnapshot(workspace);
  if (changed.files.length > 0) return changed.files;
  return reported;
}

/** Writes the iteration record the Brain reads back through `execution_summary`. */
export function recordIteration(
  workspaceId: string,
  input: { taskId: string; iteration: number; adapterId: string },
  outcome: ExecutionOutcome,
  changedFiles: number | string[]
): void {
  appendExecutionRecord(workspaceId, {
    taskId: input.taskId,
    iteration: input.iteration,
    changedFiles,
    tests: outcome.tests,
    exitStatus: outcome.exitStatus,
    timestamp: new Date().toISOString(),
    adapterId: input.adapterId,
    commands: outcome.commands.slice(0, 20),
    artifactRefs: [],
    ...(outcome.summary ? { notes: outcome.summary.slice(0, 1000) } : {}),
  });
}
