/**
 * Brain session lifecycle: resume, re-attach, and HANDOFF into a fresh
 * conversation when the old one is gone.
 *
 * Isolated from the run loop because "the conversation disappeared" is a
 * transport problem, not a protocol problem.
 */
import { createControlMessage } from "@agent2llm/protocol";
import { createEvent, type EventSink } from "@agent2llm/core";
import type { BrainAdapter, BrainSession } from "@agent2llm/adapter-sdk";
import { buildHandoffFromSession, planResume, type CollaborationSession } from "@agent2llm/session";
import type { SessionStore } from "@agent2llm/session";

export interface BrainSessionDeps {
  sessions: SessionStore;
  workspaceId: string;
  workspaceRoot: string;
  emit: EventSink;
}

export class BrainSessionManager {
  constructor(private readonly deps: BrainSessionDeps) {}

  /** Attaches to the stored conversation, or opens a new one. */
  async open(brain: BrainAdapter, session: CollaborationSession): Promise<BrainSession> {
    const base = {
      sessionId: session.sessionId,
      taskId: session.taskId,
      workspaceId: this.deps.workspaceId,
      workspaceRoot: this.deps.workspaceRoot,
      goal: session.goal,
    };

    if (session.brainSession && session.brainSession.adapterId === session.brainAdapterId) {
      const resumed = await brain.attachSession({
        adapterId: session.brainAdapterId,
        ref: session.brainSession.ref,
        savedAt: session.brainSession.savedAt,
      });
      if (planResume(session).requiresHandoff) {
        await this.sendHandoff(brain, resumed, session);
        this.deps.emit(
          createEvent({
            kind: "HANDOFF_SENT",
            message: "Brain conversation re-established with a HANDOFF brief",
            sessionId: session.sessionId,
            taskId: session.taskId,
          })
        );
      }
      return resumed;
    }

    return brain.createSession(base);
  }

  /**
   * Abandons a lost conversation and starts a new one seeded with a HANDOFF.
   * Only goal/progress/issues/next-step travel — never code or logs.
   */
  async handoff(
    brain: BrainAdapter,
    session: CollaborationSession,
    old: BrainSession
  ): Promise<BrainSession> {
    await brain.close(old).catch(() => undefined);
    const fresh = await brain.createSession({
      sessionId: session.sessionId,
      taskId: session.taskId,
      workspaceId: this.deps.workspaceId,
      workspaceRoot: this.deps.workspaceRoot,
      goal: session.goal,
    });
    await this.sendHandoff(brain, fresh, session);
    session.brainSession = {
      adapterId: session.brainAdapterId,
      ref: fresh.ref,
      savedAt: new Date().toISOString(),
    };
    this.deps.sessions.save(session);
    return fresh;
  }

  private async sendHandoff(brain: BrainAdapter, target: BrainSession, session: CollaborationSession): Promise<void> {
    await brain.sendControl(
      target,
      createControlMessage("HANDOFF", buildHandoffFromSession(session), {
        sessionId: session.sessionId,
        taskId: session.taskId,
        workspaceId: this.deps.workspaceId,
        iteration: session.iteration,
        sender: { role: "core", adapter: "core" },
      })
    );
  }
}
