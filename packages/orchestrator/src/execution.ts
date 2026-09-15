/**
 * One Harness iteration: dispatch, drain events, and turn the result into a
 * compact execution record the Brain can later review.
 *
 * Kept separate from the orchestration loop so the loop stays about protocol
 * transitions and this stays about process evidence.
 */
import { appendExecutionRecord } from "@agent2llm/execution";
import { changedSinceLastSnapshot, type Workspace } from "@agent2llm/workspace";
import type { HarnessAdapter, HarnessSession, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { Logger } from "@agent2llm/logger";

export interface ExecutionOutcome {
  ok: boolean;
  summary: string;
  changedFiles: number | string[];
  tests: string | null;
  exitStatus: string;
  commands: string[];
}

export interface IterationInput {
  harness: HarnessAdapter;
  session: HarnessSession;
  adapterId: string;
  workspaceId: string;
  workspaceRoot: string;
  taskId: string;
  iteration: number;
  goal: string;
  instructions: string[];
  successCriteria?: string;
  filesLikelyInvolved?: string[];
  logger: Logger;
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

const EMPTY_OUTCOME: ExecutionOutcome = {
  ok: false,
  summary: "",
  changedFiles: 0,
  tests: null,
  exitStatus: "unknown",
  commands: [],
};

/**
 * Runs one iteration and returns the outcome. Never throws for a failed
 * execution: a failure is data the Brain must be allowed to review.
 */
export async function executeIteration(input: IterationInput): Promise<ExecutionOutcome> {
  const handle = await input.harness.execute(input.session, {
    taskId: input.taskId,
    iteration: input.iteration,
    goal: input.goal,
    instructions: input.instructions,
    ...(input.successCriteria ? { successCriteria: input.successCriteria } : {}),
    ...(input.filesLikelyInvolved && input.filesLikelyInvolved.length > 0
      ? { filesLikelyInvolved: input.filesLikelyInvolved }
      : {}),
    workspaceRoot: input.workspaceRoot,
  });

  let outcome = EMPTY_OUTCOME;
  for await (const event of input.harness.events(handle)) {
    if (event.type === "log") {
      input.logger.debug(event.message);
      continue;
    }
    if (event.type === "approval-required") {
      await input.requestUserAction?.({
        kind: "install",
        message: `${input.adapterId} requires approval: ${event.message}`,
      });
      continue;
    }
    if (event.type === "completed") {
      outcome = {
        ok: event.result.ok,
        summary: event.result.summary,
        changedFiles: event.result.changedFiles,
        tests: event.result.tests ?? null,
        exitStatus: event.result.exitStatus,
        commands: event.result.commands ?? [],
      };
      continue;
    }
    if (event.type === "failed") {
      outcome = {
        ok: false,
        summary: event.error.message,
        changedFiles: 0,
        tests: null,
        exitStatus: event.error.code,
        commands: [],
      };
    }
  }
  return outcome;
}

/**
 * Prefers what the Harness reported, falls back to the local snapshot. The
 * snapshot wins when the Harness reported nothing but files did change, which
 * is exactly the case a silent Harness would otherwise hide.
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
