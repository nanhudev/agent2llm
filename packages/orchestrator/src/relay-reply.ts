/**
 * Reading a Brain's reply.
 *
 * Relay's half of the conversation is small enough to state exactly: a reply is
 * either a verdict that ends the run, a request to see something, or one step
 * to execute. Deciding which is the whole of this file, kept away from the loop
 * so the loop stays about ordering.
 */
import {
  buildHandoff,
  type A2LPayload,
  type ControlMessage,
  type HandoffPayload,
} from "@agent2llm/protocol";
import { parseDetailRequest } from "@agent2llm/evidence";
import type { Pair, RunStatus } from "@agent2llm/pairs";

/**
 * Every reply the core accepts from the Brain.
 *
 * `REVISE` is listed directly even though the legacy route to it is via
 * `REVIEWING`: the Brain has just been handed verified evidence, and making it
 * spend a second message before it may say "that was wrong" is friction with no
 * reader.
 */
export const VERDICT_STATES = ["NEXT_ACTION", "REVISE", "DONE", "BLOCKED", "ERROR"] as const;

export interface NextAction {
  task: string;
  acceptance: string[];
  files: string[];
}

/** DONE / BLOCKED / ERROR end the run; everything else asks for work. */
export function terminalOf(reply: ControlMessage): { status: RunStatus; summary: string } | null {
  if (reply.type === "DONE") {
    return { status: "done", summary: (reply.payload as unknown as A2LPayload["DONE"]).summary };
  }
  if (reply.type === "BLOCKED") {
    const payload = reply.payload as unknown as A2LPayload["BLOCKED"];
    return {
      status: "blocked",
      summary: payload.needs.length > 0 ? `${payload.reason} (needs: ${payload.needs.join(", ")})` : payload.reason,
    };
  }
  if (reply.type === "ERROR") {
    const payload = reply.payload as unknown as A2LPayload["ERROR"];
    return { status: "error", summary: `${payload.code}: ${payload.message}` };
  }
  return null;
}

/**
 * A Brain asks to see a file two ways, and both are honoured.
 *
 * The structured one is a `file` ref on the message, which the wire format
 * already carries. The literal one is `SHOW_DIFF <path>` as the next action,
 * which is what a plain web Brain reaches for and what the compact evidence
 * tells it to write.
 */
export function detailRequestOf(reply: ControlMessage): string | null {
  if (reply.type === "NEXT_ACTION") {
    const payload = reply.payload as unknown as A2LPayload["NEXT_ACTION"];
    const fromText = parseDetailRequest(payload.task);
    if (fromText) return fromText.file;
  }
  return reply.refs.find((entry) => entry.kind === "file")?.id ?? null;
}

/**
 * The one step to execute.
 *
 * `REVISE` becomes a step rather than a re-plan: the Brain has seen the
 * evidence and said what to change, which is a next action with a reason
 * attached. Its `requiredChanges` are joined because a Brain that listed two
 * things meant both.
 */
export function actionOf(reply: ControlMessage): NextAction | null {
  if (reply.type === "NEXT_ACTION") {
    const payload = reply.payload as unknown as A2LPayload["NEXT_ACTION"];
    return { task: payload.task, acceptance: payload.acceptance, files: payload.filesLikelyInvolved };
  }
  if (reply.type === "REVISE") {
    const payload = reply.payload as unknown as A2LPayload["REVISE"];
    return { task: payload.requiredChanges.join("\n"), acceptance: [payload.reason], files: [] };
  }
  return null;
}

/**
 * The brief a replacement conversation is given.
 *
 * Hand-built rather than derived from a session, because in Relay there is no
 * session to derive from: the run is the record, and its progress is the
 * receipts it already has. Nothing here is code, a diff or a log — the same
 * rule the collaboration handoff obeys.
 */
export function handoffFor(pair: Pair): HandoffPayload {
  return buildHandoff({
    originalGoal: pair.label ?? `${pair.brainAdapterId} x ${pair.harnessAdapterId}`,
    progress: [
      `Paired ${pair.brainAdapterId} with ${pair.harnessAdapterId} (pair ${pair.pairId}).`,
      pair.lastRunAt ? `Last run finished at ${pair.lastRunAt}.` : "This pair has not run before.",
    ],
    currentState: pair.context?.root ? `Working in ${pair.context.root}.` : "Context not established.",
    knownIssues: [],
    nextExpectedStep: "Read the compact evidence and name one executable next step.",
  });
}
