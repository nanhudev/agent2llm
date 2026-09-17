/**
 * A2L protocol constants and the finite state machine.
 *
 * A2L is the abstract control language spoken between a Brain (reasoning
 * client) and a Harness (execution agent). It carries *state*, never content:
 * workspace data travels over the read-only MCP data plane.
 */

export const A2L_PROTOCOL_ID = "a2l/1" as const;

export type A2LRole = "brain" | "harness" | "core" | "user";

export const A2L_ROLES: readonly A2LRole[] = ["brain", "harness", "core", "user"];

/**
 * The complete, finite, verifiable set of protocol states.
 *
 * BOOTSTRAP/READY describe the local runtime, not the collaboration itself.
 * INSPECTING/REVIEWING are explicit (C2C left REVIEW implicit) so that the
 * orchestrator can distinguish "brain is thinking" from "brain is silent".
 */
export const A2L_STATES = [
  "BOOTSTRAP",
  "READY",
  "INIT",
  "INSPECTING",
  "PLAN",
  "DISPATCHED",
  "EXECUTING",
  "EXECUTED",
  "NEXT_ACTION",
  "EVIDENCE_DETAIL",
  "REVIEWING",
  "REVISE",
  "DONE",
  "BLOCKED",
  "ERROR",
  "HANDOFF",
] as const;

export type A2LState = (typeof A2L_STATES)[number];

/** States in which no further workspace mutation is permitted. */
export const A2L_TERMINAL_STATES: readonly A2LState[] = ["DONE", "BLOCKED"];

/** States that allow the harness to mutate the workspace. */
export const A2L_MUTABLE_STATES: readonly A2LState[] = ["DISPATCHED", "EXECUTING"];

const T = {
  BOOTSTRAP: ["READY", "ERROR"],
  READY: ["INIT", "HANDOFF", "ERROR"],
  INIT: ["NEXT_ACTION", "INSPECTING", "PLAN", "BLOCKED", "ERROR"],
  INSPECTING: ["PLAN", "BLOCKED", "ERROR"],
  PLAN: ["DISPATCHED", "BLOCKED", "ERROR"],
  DISPATCHED: ["EXECUTING", "EXECUTED", "ERROR"],
  EXECUTING: ["EXECUTED", "ERROR", "BLOCKED"],
  // A Brain that has just read verified evidence may answer directly. The
  // legacy route to a verdict went through REVIEWING, and that is still
  // available; requiring it would be ceremony in Relay, where the evidence
  // *is* the review, and the legacy loop already listed DONE and REVISE as
  // acceptable replies here — the machine was the only thing that disagreed.
  EXECUTED: ["NEXT_ACTION", "DONE", "REVISE", "REVIEWING", "HANDOFF", "ERROR"],
  NEXT_ACTION: ["DISPATCHED", "EVIDENCE_DETAIL", "BLOCKED", "ERROR"],
  EVIDENCE_DETAIL: ["NEXT_ACTION", "REVISE", "DONE", "BLOCKED", "ERROR"],
  REVIEWING: ["DONE", "REVISE", "BLOCKED", "ERROR", "HANDOFF"],
  REVISE: ["PLAN", "DISPATCHED", "BLOCKED", "ERROR"],
  DONE: ["HANDOFF"],
  BLOCKED: ["HANDOFF", "INIT"],
  ERROR: ["INIT", "HANDOFF", "READY", "DONE", "BLOCKED"],
  HANDOFF: ["INIT", "NEXT_ACTION", "INSPECTING", "PLAN", "REVIEWING", "EXECUTED", "ERROR"],
} as const satisfies Record<A2LState, readonly A2LState[]>;

/** Adjacency list of the state machine. Anything not listed is rejected. */
export const A2L_TRANSITIONS: Readonly<Record<A2LState, readonly A2LState[]>> = T;

export function isA2LState(value: unknown): value is A2LState {
  return typeof value === "string" && (A2L_STATES as readonly string[]).includes(value);
}

export function canTransition(from: A2LState, to: A2LState): boolean {
  return A2L_TRANSITIONS[from].includes(to);
}

export type TransitionVerdict =
  | { ok: true }
  | { ok: false; reason: "unknown_state" | "illegal_transition"; message: string };

export function validateTransition(from: unknown, to: unknown): TransitionVerdict {
  if (!isA2LState(from)) {
    return { ok: false, reason: "unknown_state", message: `Unknown source state: ${String(from)}` };
  }
  if (!isA2LState(to)) {
    return { ok: false, reason: "unknown_state", message: `Unknown target state: ${String(to)}` };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      reason: "illegal_transition",
      message: `Illegal A2L transition: ${from} -> ${to}`,
    };
  }
  return { ok: true };
}

/** Who is expected to speak next. `null` means the run is over. */
export function nextSpeaker(state: A2LState): A2LRole | null {
  switch (state) {
    case "BOOTSTRAP":
    case "READY":
      return "core";
    case "INIT":
    case "EXECUTED":
    case "HANDOFF":
      return "brain";
    case "NEXT_ACTION":
      return "core";
    // The core answers the Brain's request for detail, and the Brain decides
    // on the real evidence rather than on a line count.
    case "EVIDENCE_DETAIL":
      return "brain";
    case "INSPECTING":
    case "REVIEWING":
      return "brain";
    case "PLAN":
    case "REVISE":
      return "core";
    case "DISPATCHED":
    case "EXECUTING":
      return "harness";
    case "DONE":
    case "BLOCKED":
      return null;
    case "ERROR":
      return "core";
    default:
      return null;
  }
}
