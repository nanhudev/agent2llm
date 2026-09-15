import type { A2LRef, ControlMessage } from "./envelope.js";
import { a2lPayloadSchemas, MAX_WEB_CONTROL_MESSAGE_BYTES } from "./envelope.js";
import { A2L_PROTOCOL_ID, isA2LState, type A2LState } from "./states.js";
import type { z } from "zod";

/**
 * Text wire format for web brains (ChatGPT / Claude chat boxes).
 *
 * The control plane is typed into a normal conversation, so it has to be
 * small, greppable and parseable without JSON-in-markdown ambiguity.
 * Payload keys are camelCase -> UPPER_SNAKE on the wire.
 */
export const A2L_WIRE_MARKER = "[A2L]";

const HEADER_ORDER = ["PROTOCOL", "SESSION", "TASK", "ITERATION", "STATE", "WORKSPACE", "FROM", "TIME"] as const;

function toWireKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function formatValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `- ${String(item)}`);
  }
  if (value === null || value === undefined) return ["null"];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  if (typeof value === "number") return [String(value)];
  return String(value).split("\n");
}

/** Serialize a control message to the `[A2L]` text form. */
export function encodeControlMessage(message: ControlMessage): string {
  const lines: string[] = [A2L_WIRE_MARKER];
  lines.push(`PROTOCOL: ${message.protocol}`);
  lines.push(`SESSION: ${message.sessionId}`);
  lines.push(`TASK: ${message.taskId}`);
  lines.push(`ITERATION: ${message.iteration}`);
  lines.push(`STATE: ${message.type}`);
  lines.push(`WORKSPACE: ${message.workspaceId}`);
  lines.push(`FROM: ${message.sender.role}/${message.sender.adapter}`);
  lines.push(`TIME: ${message.timestamp}`);
  const payload = (message.payload ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push("");
    lines.push(`${toWireKey(key)}:`);
    lines.push(...formatValue(value));
  }
  if (message.refs.length > 0) {
    lines.push("");
    lines.push("REFS:");
    for (const ref of message.refs) {
      lines.push(`- ${ref.kind}:${ref.id}`);
    }
  }
  return lines.join("\n");
}

/** Extract the last `[A2L]` block from a chat message. */
export function extractControlBlock(text: string): string | null {
  const index = text.lastIndexOf(A2L_WIRE_MARKER);
  if (index === -1) return null;
  return text.slice(index);
}

interface Section {
  key: string;
  lines: string[];
}

function parseSections(block: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(raw);
    if (match) {
      current = { key: match[1]!, lines: match[2] ? [match[2]] : [] };
      sections.push(current);
    } else if (current) {
      if (raw.trim() === "" && current.lines.length === 0) continue;
      current.lines.push(raw);
    }
  }
  return sections;
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
}

type AnySchema = z.ZodTypeAny;

function unwrap(schema: AnySchema): AnySchema {
  const def = schema._def as { typeName?: string; innerType?: AnySchema };
  if (def.typeName === "ZodDefault" || def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
    const inner = (schema as unknown as { _def: { innerType?: AnySchema } })._def.innerType;
    return inner ? unwrap(inner) : schema;
  }
  void def;
  return schema;
}

function typeName(schema: AnySchema): string {
  return ((schema._def as { typeName?: string }).typeName ?? "").toString();
}

function convert(lines: string[], schema: AnySchema): unknown {
  const inner = unwrap(schema);
  const name = typeName(inner);
  if (name === "ZodArray") {
    return lines
      .map(stripBullet)
      .filter((line) => line !== "")
      .map((line) => {
        const element = (inner as unknown as { _def: { type: AnySchema } })._def.type;
        return convert([line], element) as string;
      });
  }
  // Unions (e.g. `changedFiles: number | string[]`) are resolved by trying
  // each option and preferring the richest successful candidate. A scalar
  // option must not win over an array just because `Number(x)` is finite.
  if (name === "ZodUnion") {
    const options = (inner as unknown as { _def: { options?: AnySchema[] } })._def.options ?? [];
    const candidates: unknown[] = [];
    for (const option of options) {
      try {
        const candidate = convert(lines, option);
        if (option.safeParse(candidate).success) candidates.push(candidate);
      } catch {
        // try the next option
      }
    }
    if (candidates.length > 0) {
      const arrayCandidate = candidates.find((value) => Array.isArray(value) && value.length > 0);
      return arrayCandidate ?? candidates[0];
    }
  }
  const joined = lines.join("\n").trim();
  if (name === "ZodNumber") {
    const value = Number(joined);
    return Number.isFinite(value) ? value : 0;
  }
  if (name === "ZodBoolean") return joined === "true";
  if (name === "ZodNullable") {
    return joined === "" || joined === "null" ? null : joined;
  }
  if (joined === "null") return null;
  return joined;
}

export type WireParseResult =
  | { ok: true; message: ControlMessage }
  | { ok: false; error: string };

function buildEnvelopeShape(block: string): ControlMessage {
  const sections = parseSections(block);
  const byKey = new Map(sections.map((section) => [section.key, section.lines]));
  const require = (key: string): string => {
    const value = byKey.get(key)?.[0];
    if (!value) throw new Error(`Missing ${key} header in A2L control block`);
    return value;
  };
  const protocol = require("PROTOCOL");
  if (protocol !== A2L_PROTOCOL_ID) throw new Error(`Unsupported protocol: ${protocol}`);
  const state = require("STATE");
  if (!isA2LState(state)) throw new Error(`Unknown A2L state: ${state}`);
  const from = require("FROM");
  const [role, adapter] = from.split("/");
  if (!role || !adapter) throw new Error("FROM header must look like role/adapter-id");

  const payloadSchema = a2lPayloadSchemas[state as A2LState] as unknown as z.ZodObject<z.ZodRawShape>;
  const shape = payloadSchema.shape as Record<string, AnySchema>;
  const payload: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, schema] of Object.entries(shape)) {
    const section = byKey.get(toWireKey(key));
    if (!section) continue;
    try {
      payload[key] = convert(section, schema);
    } catch (error) {
      errors.push(`${key}: ${(error as Error).message}`);
    }
  }

  const parse = payloadSchema.safeParse(payload);
  if (!parse.success) {
    const issue = parse.error.issues[0];
    errors.push(issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid payload");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));

  const refs: A2LRef[] = (byKey.get("REFS") ?? [])
    .map(stripBullet)
    .map((entry) => {
      const [kind, id] = entry.split(":");
      return kind && id ? { kind: kind as A2LRef["kind"], id } : null;
    })
    .filter((ref): ref is A2LRef => ref !== null);

  return {
    protocol: A2L_PROTOCOL_ID,
    sessionId: require("SESSION"),
    taskId: require("TASK"),
    iteration: Number(require("ITERATION")),
    type: state as A2LState,
    workspaceId: require("WORKSPACE"),
    sender: { role, adapter } as ControlMessage["sender"],
    timestamp: require("TIME"),
    payload: parse.success ? (parse.data as Record<string, unknown>) : {},
    refs,
  };
}

/** Parse a chat message into a control message. */
export function parseControlBlock(text: string): WireParseResult {
  const block = extractControlBlock(text);
  if (!block) return { ok: false, error: "No [A2L] control block found" };
  try {
    return { ok: true, message: buildEnvelopeShape(block) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Web brains have a tighter budget than the protocol maximum. */
export function wireBytes(message: ControlMessage): number {
  return Buffer.byteLength(encodeControlMessage(message), "utf8");
}

export function exceedsWebBudget(message: ControlMessage): boolean {
  return wireBytes(message) > MAX_WEB_CONTROL_MESSAGE_BYTES;
}

export { HEADER_ORDER };
