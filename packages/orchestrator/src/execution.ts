/**
 * One Harness iteration: dispatch, drain events, and turn the result into a
 * compact execution record the Brain can later review.
 *
 * Kept separate from the orchestration loop so the loop stays about protocol
 * transitions and this stays about process evidence.
 */
import type { ExecutionRequest, HarnessAdapter, HarnessSession, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { Logger } from "@agent2llm/logger";

export interface ExecutionOutcome {
  ok: boolean;
  summary: string;
  changedFiles: number | string[];
  tests: string | null;
  exitStatus: string;
  commands: string[];
  /** Wall-clock time the harness reported for the execution. */
  durationMs: number;
}

export interface IterationInput {
  harness: HarnessAdapter;
  session: HarnessSession;
  adapterId: string;
  /**
   * The dispatch, built by the caller.
   *
   * Passed in rather than assembled here so that whoever wrote it can also
   * *measure* it: Relay reports how many bytes it sent the Harness, and a
   * number produced by a second renderer would be a number about nothing.
   */
  request: ExecutionRequest;
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
  durationMs: 0,
};

/**
 * Runs one iteration and returns the outcome. Never throws for a failed
 * execution: a failure is data the Brain must be allowed to review.
 */
export async function executeIteration(input: IterationInput): Promise<ExecutionOutcome> {
  const handle = await input.harness.execute(input.session, input.request);

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
        durationMs: event.result.durationMs ?? 0,
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
        durationMs: 0,
      };
    }
  }
  return outcome;
}

/**
 * The pre-relay dispatch, built in one place.
 *
 * It lives beside `executeIteration` because it is the same decision: this is
 * the request whose `renderStandardBrief` every brain-hands step has always
 * sent. Relay is the mode that added a second shape, not a change to this one.
 */
export function stepRequest(input: {
  taskId: string;
  iteration: number;
  goal: string;
  instructions: string[];
  workspaceRoot: string;
  successCriteria?: string;
  filesLikelyInvolved?: string[];
}): ExecutionRequest {
  return {
    taskId: input.taskId,
    iteration: input.iteration,
    goal: input.goal,
    instructions: input.instructions,
    ...(input.successCriteria ? { successCriteria: input.successCriteria } : {}),
    ...(input.filesLikelyInvolved && input.filesLikelyInvolved.length > 0
      ? { filesLikelyInvolved: input.filesLikelyInvolved }
      : {}),
    workspaceRoot: input.workspaceRoot,
  };
}
