import { newId } from "./ids.js";
import type { A2LState } from "@agent2llm/protocol";

/**
 * Structured observability events. Every renderer (human CLI output, JSON
 * for other agents, logs) consumes this single stream.
 */
export const A2L_EVENT_KINDS = [
  "SESSION_CREATED",
  "SESSION_RESUMED",
  "STATE_CHANGED",
  "BRAIN_CONNECTED",
  "HARNESS_CONNECTED",
  "ADAPTER_DETECTED",
  "WORKSPACE_BOUND",
  "CONTROL_SENT",
  "CONTROL_RECEIVED",
  "PLAN_RECEIVED",
  "EXECUTION_STARTED",
  "EXECUTION_COMPLETED",
  "NEXT_ACTION_RECEIVED",
  "EVIDENCE_COLLECTED",
  "REVIEW_STARTED",
  "REVISION_REQUESTED",
  "USER_ACTION_REQUIRED",
  "HANDOFF_SENT",
  "TASK_DONE",
  "TASK_BLOCKED",
  "ERROR",
] as const;

export type A2LEventKind = (typeof A2L_EVENT_KINDS)[number];

export interface A2LEventBase {
  id: string;
  kind: A2LEventKind;
  at: string;
  sessionId?: string;
  taskId?: string;
  iteration?: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface StateChangedEvent extends A2LEventBase {
  kind: "STATE_CHANGED";
  from: A2LState;
  to: A2LState;
}

export type A2LEvent = A2LEventBase | StateChangedEvent;

export interface EventInput {
  kind: A2LEventKind;
  message: string;
  sessionId?: string;
  taskId?: string;
  iteration?: number;
  data?: Record<string, unknown>;
}

export function createEvent(input: EventInput): A2LEvent {
  return {
    id: newId("ev", 6),
    kind: input.kind,
    at: new Date().toISOString(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.iteration !== undefined ? { iteration: input.iteration } : {}),
    message: input.message,
    ...(input.data ? { data: input.data } : {}),
  };
}

export function createStateChangedEvent(
  from: A2LState,
  to: A2LState,
  input: Omit<EventInput, "kind" | "message">
): StateChangedEvent {
  return {
    ...createEvent({ ...input, kind: "STATE_CHANGED", message: `${from} -> ${to}` }),
    kind: "STATE_CHANGED",
    from,
    to,
  };
}

const HUMAN_LABELS: Record<A2LEventKind, string> = {
  SESSION_CREATED: "session created",
  SESSION_RESUMED: "session resumed",
  STATE_CHANGED: "state",
  BRAIN_CONNECTED: "brain connected",
  HARNESS_CONNECTED: "harness connected",
  ADAPTER_DETECTED: "adapter detected",
  WORKSPACE_BOUND: "workspace bound",
  CONTROL_SENT: "control sent",
  CONTROL_RECEIVED: "control received",
  PLAN_RECEIVED: "plan received",
  NEXT_ACTION_RECEIVED: "next action received",
  EVIDENCE_COLLECTED: "evidence collected",
  EXECUTION_STARTED: "executing",
  EXECUTION_COMPLETED: "execution finished",
  REVIEW_STARTED: "reviewing",
  REVISION_REQUESTED: "revision requested",
  USER_ACTION_REQUIRED: "action required",
  HANDOFF_SENT: "handoff",
  TASK_DONE: "done",
  TASK_BLOCKED: "blocked",
  ERROR: "error",
};

/** Human renderer: one short line, no protocol noise. */
export function formatEventHuman(event: A2LEvent): string {
  const label = HUMAN_LABELS[event.kind] ?? event.kind.toLowerCase();
  const tail = event.kind === "STATE_CHANGED" ? "" : ` — ${event.message}`;
  return `${label}${tail}`;
}

export function formatEventJson(event: A2LEvent): string {
  return JSON.stringify(event);
}

export type EventSink = (event: A2LEvent) => void;

export function collectEvents(): { sink: EventSink; events: A2LEvent[] } {
  const events: A2LEvent[] = [];
  return { sink: (event) => events.push(event), events };
}
