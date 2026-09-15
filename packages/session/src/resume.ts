import type { HandoffPayload } from "@agent2llm/protocol";
import { buildHandoff } from "@agent2llm/protocol";
import type { CollaborationSession } from "./model.js";

/**
 * Resume and handoff.
 *
 * When the Brain conversation is lost, Agent2LLM does not replay history:
 * it opens a new conversation and sends a HANDOFF brief built from the local
 * checkpoint. The new Brain re-reads code through the data plane.
 */
export function buildHandoffFromSession(session: CollaborationSession): HandoffPayload {
  const checkpoint = session.checkpoint;
  return buildHandoff({
    originalGoal: checkpoint?.goal ?? session.goal,
    progress: checkpoint?.progress ?? [`Reached ${session.protocolState} at iteration ${session.iteration}.`],
    currentState: checkpoint?.currentState ?? `Protocol state: ${session.protocolState}`,
    knownIssues: checkpoint?.knownIssues ?? session.issues.slice(-5).map((issue) => issue.message),
    nextExpectedStep:
      checkpoint?.nextExpectedStep ?? "Inspect the workspace through MCP and continue the task.",
  });
}

export function needsBrainHandoff(session: CollaborationSession): boolean {
  return session.iteration > 0 && session.protocolState !== "DONE" && session.protocolState !== "BLOCKED";
}

export interface ResumePlan {
  sessionId: string;
  taskId: string;
  iteration: number;
  requiresHandoff: boolean;
  message: string;
}

export function planResume(session: CollaborationSession): ResumePlan {
  const requiresHandoff = needsBrainHandoff(session);
  return {
    sessionId: session.sessionId,
    taskId: session.taskId,
    iteration: session.iteration,
    requiresHandoff,
    message: requiresHandoff
      ? "Resuming: the Brain conversation will be re-established with a HANDOFF brief."
      : "Resuming: the existing conversation can continue without a handoff.",
  };
}
