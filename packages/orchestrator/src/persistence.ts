/**
 * Session persistence.
 *
 * Everything written here is small by construction: the checkpoint carries
 * goal, progress and next step, never code, diffs or logs.
 */
import type { A2LState, ControlMessage } from "@agent2llm/protocol";
import type { SessionStore, CollaborationSession } from "@agent2llm/session";

/** Applies an inbound control message to the stored session state. */
export function persistFromMessage(sessions: SessionStore, message: ControlMessage): void {
  const session = sessions.get(message.sessionId);
  if (!session) return;
  session.protocolState = message.type;
  if (message.iteration > session.iteration) session.iteration = message.iteration;
  session.brainSession = {
    adapterId: session.brainAdapterId,
    ref: session.brainSession?.ref ?? {},
    savedAt: new Date().toISOString(),
  };
  if (message.type === "ERROR") {
    const payload = message.payload as { code?: string; message?: string };
    session.issues.push({
      at: new Date().toISOString(),
      iteration: message.iteration,
      code: String(payload.code ?? "ERROR"),
      message: String(payload.message ?? "").slice(0, 500),
    });
  }
  sessions.save(session);
}

/** Writes the resumable checkpoint after a revision round. */
export function persistCheckpoint(
  sessions: SessionStore,
  session: CollaborationSession,
  state: A2LState,
  currentState: string,
  next: string
): void {
  session.protocolState = state;
  session.updatedAt = new Date().toISOString();
  session.checkpoint = {
    goal: session.goal.slice(0, 500),
    progress: [`Iteration ${session.iteration} completed.`],
    knownIssues: session.issues.slice(-5).map((issue) => issue.message),
    currentState: currentState.slice(0, 300),
    nextExpectedStep: next.slice(0, 400),
  };
  session.brainSession = {
    adapterId: session.brainAdapterId,
    ref: session.brainSession?.ref ?? {},
    savedAt: new Date().toISOString(),
  };
  sessions.save(session);
}

/** Marks the session finished and returns the human-facing summary. */
export function finalizeSession(
  sessions: SessionStore,
  session: CollaborationSession,
  message: ControlMessage
): string {
  session.protocolState = message.type;
  session.finishedAt = new Date().toISOString();
  session.updatedAt = session.finishedAt;
  sessions.save(session);
  return summaryOf(message);
}

export function summaryOf(message: ControlMessage): string {
  const payload = message.payload as Record<string, unknown>;
  const value = payload.summary ?? payload.reason ?? payload.message ?? payload.result;
  return typeof value === "string" ? value : `${message.type}`;
}
