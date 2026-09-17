/**
 * Brain session lifecycle: resume, re-attach, and HANDOFF into a fresh
 * conversation when the old one is gone.
 *
 * Isolated from the run loop because "the conversation disappeared" is a
 * transport problem, not a protocol problem.
 *
 * Two callers share the attach-or-create decision, and they differ on exactly
 * one point. The legacy brain-hands loop attaches to a session's stored
 * conversation and treats a failed attach as fatal — the run should stop and
 * say so. A relay Pair owns its conversation directly and outlives several
 * runs, so a conversation the Brain no longer has (a closed tab, an expired
 * web session) is a normal event it recovers from with a HANDOFF. That policy
 * is a parameter; everything else is shared, so there is one implementation of
 * "which conversation is this run talking to".
 */
import { createControlMessage, type HandoffPayload } from "@agent2llm/protocol";
import { createEvent, type EventSink } from "@agent2llm/core";
import type { BrainAdapter, BrainSession } from "@agent2llm/adapter-sdk";
import {
  buildHandoffFromSession,
  planResume,
  type AdapterRef,
  type CollaborationSession,
  type SessionStore,
} from "@agent2llm/session";

/** The labels an adapter uses to name a conversation. */
export interface ConversationBase {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  workspaceRoot: string;
  goal: string;
}

export interface OpenConversationInput {
  base: ConversationBase;
  /** The stored pointer, or null when nothing has been stored yet. */
  ref: AdapterRef | null;
  /** Brief for a conversation that attached successfully mid-task. */
  resumeBrief?: HandoffPayload;
  /**
   * Create a new conversation, briefed with this, instead of failing when the
   * stored one will not attach.
   *
   * Set by Relay, where the pair outlives the conversation. Unset by the
   * legacy loop, where a conversation that will not attach is a fault the
   * operator should see rather than a state Agent2LLM silently papers over.
   */
  replacementBrief?: HandoffPayload;
}

/** How the conversation this run is talking to came to exist. */
export type ConversationOutcome = "created" | "attached" | "replaced";

export interface OpenedConversation {
  session: BrainSession;
  outcome: ConversationOutcome;
}

/**
 * Sends a HANDOFF message.
 *
 * The only place one is constructed, so the iteration number and the
 * core-as-sender rule cannot drift between callers.
 */
export async function sendHandoffBrief(
  brain: BrainAdapter,
  session: BrainSession,
  base: ConversationBase,
  payload: HandoffPayload,
  iteration = 0
): Promise<void> {
  await brain.sendControl(
    session,
    createControlMessage("HANDOFF", payload, {
      sessionId: base.sessionId,
      taskId: base.taskId,
      workspaceId: base.workspaceId,
      iteration,
      sender: { role: "core", adapter: "core" },
    })
  );
}

/**
 * Attaches to the conversation behind `ref`, or opens one.
 *
 * A ref belonging to a different adapter is treated as absent rather than
 * handed to the wrong product: the pointer is opaque, so the only safe check
 * available is which adapter wrote it.
 */
export async function openBrainConversation(
  brain: BrainAdapter,
  input: OpenConversationInput
): Promise<OpenedConversation> {
  const { base, ref } = input;
  const adapterId = brain.metadata().id;

  if (ref && ref.adapterId === adapterId) {
    try {
      const attached = await brain.attachSession({
        adapterId: ref.adapterId,
        ref: ref.ref,
        savedAt: ref.savedAt,
      });
      if (input.resumeBrief) await sendHandoffBrief(brain, attached, base, input.resumeBrief);
      return { session: attached, outcome: "attached" };
    } catch (error) {
      if (!input.replacementBrief) throw error;
      const replacement = await brain.createSession(base);
      await sendHandoffBrief(brain, replacement, base, input.replacementBrief);
      return { session: replacement, outcome: "replaced" };
    }
  }

  return { session: await brain.createSession(base), outcome: "created" };
}

export interface BrainSessionDeps {
  sessions: SessionStore;
  workspaceId: string;
  workspaceRoot: string;
  emit: EventSink;
}

export class BrainSessionManager {
  constructor(private readonly deps: BrainSessionDeps) {}

  private base(session: CollaborationSession): ConversationBase {
    return {
      sessionId: session.sessionId,
      taskId: session.taskId,
      workspaceId: this.deps.workspaceId,
      workspaceRoot: this.deps.workspaceRoot,
      goal: session.goal,
    };
  }

  /** Attaches to the stored conversation, or opens a new one. */
  async open(brain: BrainAdapter, session: CollaborationSession): Promise<BrainSession> {
    const ref = session.brainSession?.adapterId === session.brainAdapterId ? session.brainSession : null;
    const requiresHandoff = planResume(session).requiresHandoff;
    const opened = await openBrainConversation(brain, {
      base: this.base(session),
      ref,
      ...(requiresHandoff ? { resumeBrief: buildHandoffFromSession(session) } : {}),
    });
    if (opened.outcome === "attached" && requiresHandoff) {
      this.deps.emit(
        createEvent({
          kind: "HANDOFF_SENT",
          message: "Brain conversation re-established with a HANDOFF brief",
          sessionId: session.sessionId,
          taskId: session.taskId,
        })
      );
    }
    return opened.session;
  }

  /**
   * Abandons a lost conversation and starts a new one seeded with a HANDOFF.
   * Only goal/progress/issues/next-step travel — never code or logs.
   */
  async handoff(brain: BrainAdapter, session: CollaborationSession, old: BrainSession): Promise<BrainSession> {
    await brain.close(old).catch(() => undefined);
    const fresh = await brain.createSession(this.base(session));
    await sendHandoffBrief(brain, fresh, this.base(session), buildHandoffFromSession(session));
    session.brainSession = {
      adapterId: session.brainAdapterId,
      ref: fresh.ref,
      savedAt: new Date().toISOString(),
    };
    this.deps.sessions.save(session);
    return fresh;
  }
}
