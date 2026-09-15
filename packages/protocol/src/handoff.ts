import { z } from "zod";
import { handoffPayloadSchema } from "./envelope.js";

/**
 * HANDOFF: the only legal way to continue a task in a *new* Brain
 * conversation. It is a brief, never a data dump — the replacement
 * conversation re-reads the workspace through the MCP data plane.
 */
export type HandoffPayload = z.infer<typeof handoffPayloadSchema>;

export const HANDOFF_FIELD_LIMITS = {
  originalGoal: 500,
  currentState: 300,
  nextExpectedStep: 400,
  lineItem: 300,
  maxItems: 12,
} as const;

function cap(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export interface HandoffSource {
  originalGoal: string;
  progress?: readonly string[];
  currentState: string;
  knownIssues?: readonly string[];
  nextExpectedStep: string;
}

export function buildHandoff(source: HandoffSource): HandoffPayload {
  return handoffPayloadSchema.parse({
    originalGoal: cap(source.originalGoal, HANDOFF_FIELD_LIMITS.originalGoal),
    progress: (source.progress ?? [])
      .slice(0, HANDOFF_FIELD_LIMITS.maxItems)
      .map((line) => cap(line, HANDOFF_FIELD_LIMITS.lineItem)),
    currentState: cap(source.currentState, HANDOFF_FIELD_LIMITS.currentState),
    knownIssues: (source.knownIssues ?? [])
      .slice(0, HANDOFF_FIELD_LIMITS.maxItems)
      .map((line) => cap(line, HANDOFF_FIELD_LIMITS.lineItem)),
    nextExpectedStep: cap(source.nextExpectedStep, HANDOFF_FIELD_LIMITS.nextExpectedStep),
  });
}

/** Forbidden content: handoffs never carry logs, diffs or file bodies. */
const FORBIDDEN = [/```/, /BEGIN [A-Z ]*PRIVATE KEY/, /^\s{2,}\S+/m];

export function assertHandoffIsBrief(payload: HandoffPayload): void {
  const serialized = JSON.stringify(payload);
  if (serialized.length > 3000) {
    throw new Error("HANDOFF exceeds the 3000 byte brevity budget");
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(serialized)) {
      throw new Error("HANDOFF appears to contain code blocks, keys or log dumps");
    }
  }
}
