/**
 * C2C (codex-with-chatgpt) compatibility mapping.
 *
 * Agent2LLM does not reuse the C2C protocol name, but C2C semantics are a
 * proven subset of A2L. This module maps between them so existing C2C
 * sessions, skills and harness wrappers can be migrated instead of rewritten.
 */
import type { A2LState } from "./states.js";

export type C2CState =
  | "INIT"
  | "PLAN"
  | "EXECUTING"
  | "EXECUTED"
  | "REVIEW"
  | "DONE"
  | "BLOCKED"
  | "ERROR"
  | "HANDOFF";

export const A2L_TO_C2C: Readonly<Record<A2LState, C2CState | null>> = {
  BOOTSTRAP: null,
  READY: null,
  INIT: "INIT",
  INSPECTING: "REVIEW",
  PLAN: "PLAN",
  DISPATCHED: "EXECUTING",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  REVIEWING: "REVIEW",
  REVISE: "PLAN",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
  HANDOFF: "HANDOFF",
};

export function isC2CState(value: string): value is C2CState {
  return Object.prototype.hasOwnProperty.call(C2C_TO_A2L, value);
}

export const C2C_TO_A2L: Readonly<Record<C2CState, A2LState>> = {
  INIT: "INIT",
  PLAN: "PLAN",
  EXECUTING: "DISPATCHED",
  EXECUTED: "EXECUTED",
  REVIEW: "REVIEWING",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
  HANDOFF: "HANDOFF",
};

/**
 * Lenient variant used by migration tooling: returns `null` instead of
 * `undefined` for strings this build does not recognise.
 */
export function mapC2CState(state: string): A2LState | null {
  return isC2CState(state) ? C2C_TO_A2L[state] : null;
}

export function toC2CState(state: A2LState): C2CState | null {
  return A2L_TO_C2C[state];
}

export function fromC2CState(state: C2CState): A2LState {
  return C2C_TO_A2L[state];
}

/** Field-level mapping for the EXECUTED record, which C2C harnesses emit. */
export interface C2CExecutedRecord {
  taskId: string;
  iteration: number;
  changedFiles: number | string[];
  tests?: string | null;
  exitStatus?: string;
}

export interface A2LExecutedPayload {
  result: string;
  changedFiles: number | string[];
  tests: string | null;
  exitStatus: string;
  commands: string[];
}

export function c2cRecordToA2LExecuted(record: C2CExecutedRecord): A2LExecutedPayload {
  return {
    result: "Execution finished.",
    changedFiles: record.changedFiles,
    tests: record.tests ?? null,
    exitStatus: record.exitStatus ?? "ok",
    commands: [],
  };
}
