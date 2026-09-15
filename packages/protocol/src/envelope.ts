import { z } from "zod";
import { A2L_PROTOCOL_ID, A2L_STATES, type A2LRole } from "./states.js";

/**
 * Control-plane envelope.
 *
 * Hard rule inherited from C2C: the control plane carries state, ids,
 * summaries, counts, references and intent — never file bodies, diffs or logs.
 */
export const A2L_PROTOCOL_VERSIONS = [A2L_PROTOCOL_ID] as const;

/** Absolute ceiling for any control message. */
export const MAX_CONTROL_MESSAGE_BYTES = 4 * 1024;
/** Target ceiling for web-based brains typed into a chat box. */
export const MAX_WEB_CONTROL_MESSAGE_BYTES = 1024;

export const a2lRefSchema = z.object({
  kind: z.enum(["workspace", "session", "execution", "file", "artifact", "conversation"]),
  id: z.string().min(1).max(200),
  summary: z.string().max(200).optional(),
});
export type A2LRef = z.infer<typeof a2lRefSchema>;

export const a2lSenderSchema = z.object({
  role: z.enum(["brain", "harness", "core", "user"]),
  adapter: z.string().min(1).max(64),
});
export type A2LSender = z.infer<typeof a2lSenderSchema>;

// ---- Payloads ---------------------------------------------------------------

export const initPayloadSchema = z.object({
  goal: z.string().min(1).max(1000),
  instruction: z.string().max(1000).optional(),
  constraints: z.array(z.string().max(300)).max(20).default([]),
});

export const inspectingPayloadSchema = z.object({
  focus: z.string().max(500).optional(),
});

export const planPayloadSchema = z.object({
  goal: z.string().min(1).max(1000),
  rationale: z.string().max(1500).default(""),
  actions: z.array(z.string().min(1).max(500)).min(1).max(25),
  filesLikelyInvolved: z.array(z.string().min(1).max(300)).max(50).default([]),
  tests: z.string().max(500).default(""),
  successCriteria: z.string().max(1000).default(""),
});

export const dispatchedPayloadSchema = z.object({
  actionCount: z.number().int().nonnegative(),
  planDigest: z.string().max(120).optional(),
});

export const executingPayloadSchema = z.object({
  step: z.string().max(300).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

export const executedPayloadSchema = z.object({
  result: z.string().min(1).max(1000),
  changedFiles: z.union([z.number().int().nonnegative(), z.array(z.string().max(300)).max(200)]),
  tests: z.string().max(300).nullable().default(null),
  exitStatus: z.string().max(60).default("ok"),
  commands: z.array(z.string().max(200)).max(20).default([]),
});

export const reviewingPayloadSchema = z.object({
  focus: z.string().max(500).optional(),
});

export const revisePayloadSchema = z.object({
  reason: z.string().min(1).max(1000),
  requiredChanges: z.array(z.string().min(1).max(500)).min(1).max(25),
});

export const donePayloadSchema = z.object({
  summary: z.string().min(1).max(1000),
});

export const blockedPayloadSchema = z.object({
  reason: z.string().min(1).max(1000),
  needs: z.array(z.string().max(300)).max(20).default([]),
});

export const errorPayloadSchema = z.object({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
  recoverable: z.boolean().default(false),
});

export const handoffPayloadSchema = z.object({
  originalGoal: z.string().min(1).max(500),
  progress: z.array(z.string().max(300)).max(12).default([]),
  currentState: z.string().min(1).max(300),
  knownIssues: z.array(z.string().max(300)).max(12).default([]),
  nextExpectedStep: z.string().min(1).max(400),
});

export const emptyPayloadSchema = z.object({});

export const a2lPayloadSchemas = {
  BOOTSTRAP: emptyPayloadSchema,
  READY: emptyPayloadSchema,
  INIT: initPayloadSchema,
  INSPECTING: inspectingPayloadSchema,
  PLAN: planPayloadSchema,
  DISPATCHED: dispatchedPayloadSchema,
  EXECUTING: executingPayloadSchema,
  EXECUTED: executedPayloadSchema,
  REVIEWING: reviewingPayloadSchema,
  REVISE: revisePayloadSchema,
  DONE: donePayloadSchema,
  BLOCKED: blockedPayloadSchema,
  ERROR: errorPayloadSchema,
  HANDOFF: handoffPayloadSchema,
} as const;

export type A2LPayload = {
  [K in keyof typeof a2lPayloadSchemas]: z.infer<(typeof a2lPayloadSchemas)[K]>;
};

export type A2LTypedPayload =
  | ({ type: "BOOTSTRAP" } & A2LPayload["BOOTSTRAP"])
  | ({ type: "READY" } & A2LPayload["READY"])
  | ({ type: "INIT" } & A2LPayload["INIT"])
  | ({ type: "INSPECTING" } & A2LPayload["INSPECTING"])
  | ({ type: "PLAN" } & A2LPayload["PLAN"])
  | ({ type: "DISPATCHED" } & A2LPayload["DISPATCHED"])
  | ({ type: "EXECUTING" } & A2LPayload["EXECUTING"])
  | ({ type: "EXECUTED" } & A2LPayload["EXECUTED"])
  | ({ type: "REVIEWING" } & A2LPayload["REVIEWING"])
  | ({ type: "REVISE" } & A2LPayload["REVISE"])
  | ({ type: "DONE" } & A2LPayload["DONE"])
  | ({ type: "BLOCKED" } & A2LPayload["BLOCKED"])
  | ({ type: "ERROR" } & A2LPayload["ERROR"])
  | ({ type: "HANDOFF" } & A2LPayload["HANDOFF"]);

export const controlMessageSchema = z.object({
  protocol: z.enum(A2L_PROTOCOL_VERSIONS),
  sessionId: z.string().min(1).max(120),
  taskId: z.string().min(1).max(120),
  iteration: z.number().int().nonnegative(),
  type: z.enum(A2L_STATES),
  workspaceId: z.string().min(1).max(120),
  sender: a2lSenderSchema,
  timestamp: z.string().datetime({ offset: true }).or(z.string().min(4)),
  payload: z.record(z.unknown()).default({}),
  refs: z.array(a2lRefSchema).max(50).default([]),
});

export type ControlMessage = z.infer<typeof controlMessageSchema>;

export type ControlMessageOf<T extends keyof typeof a2lPayloadSchemas> = Omit<
  ControlMessage,
  "type" | "payload"
> & { type: T; payload: A2LPayload[T] };

// ---- Construction and validation ---------------------------------------------

export interface CreateEnvelopeInput {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  iteration: number;
  sender: A2LSender | A2LRole;
  timestamp?: string;
  refs?: A2LRef[];
}

export function senderOf(role: A2LRole, adapter: string): A2LSender {
  return { role, adapter };
}

export function createControlMessage<T extends keyof typeof a2lPayloadSchemas>(
  type: T,
  payload: A2LPayload[T],
  input: CreateEnvelopeInput
): ControlMessageOf<T> {
  return {
    protocol: A2L_PROTOCOL_ID,
    sessionId: input.sessionId,
    taskId: input.taskId,
    iteration: input.iteration,
    type,
    workspaceId: input.workspaceId,
    sender: typeof input.sender === "string" ? senderOf(input.sender, "core") : input.sender,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: payload as unknown as Record<string, unknown>,
    refs: input.refs ?? [],
  } as ControlMessageOf<T>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseControlMessage(input: unknown): ParseResult<ControlMessage> {
  const base = controlMessageSchema.safeParse(input);
  if (!base.success) {
    return { ok: false, error: `Invalid A2L envelope: ${base.error.issues[0]?.message ?? "unknown"}` };
  }
  const payloadResult = a2lPayloadSchemas[base.data.type].safeParse(base.data.payload);
  if (!payloadResult.success) {
    return {
      ok: false,
      error: `Invalid A2L ${base.data.type} payload: ${payloadResult.error.issues[0]?.message ?? "unknown"}`,
    };
  }
  return { ok: true, value: { ...base.data, payload: payloadResult.data as Record<string, unknown> } };
}

/** Byte size of a serialized control message. */
export function controlMessageBytes(message: ControlMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

export type SizeVerdict = { ok: true; bytes: number } | { ok: false; bytes: number; limit: number };

export function checkControlMessageSize(
  message: ControlMessage,
  limit: number = MAX_CONTROL_MESSAGE_BYTES
): SizeVerdict {
  const bytes = controlMessageBytes(message);
  return bytes <= limit ? { ok: true, bytes } : { ok: false, bytes, limit };
}

/**
 * Content guard: control messages must never smuggle workspace content.
 * This is a defence-in-depth check; the real boundary is that Brain adapters
 * only ever *send* typed payloads produced by the orchestrator.
 */
const CONTENT_KEYS = ["content", "diff", "fileBody", "source", "logs", "patch"] as const;

export function assertNoContent(message: ControlMessage): void {
  for (const key of CONTENT_KEYS) {
    if (key in message.payload) {
      throw new Error(
        `Control message of type ${message.type} carries forbidden content key '${key}'. Use the MCP data plane.`
      );
    }
  }
}
