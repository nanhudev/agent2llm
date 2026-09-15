/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
/**
 * Opt-in command output store.
 *
 * A Harness may nominate a test/build/lint log; a local sanitizer decides
 * whether the Brain may see the body. Restricted items are listed without a
 * body, so the Brain can still reason about "there was output, it was withheld".
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "@agent2llm/config";
import { sanitizeOutput } from "./sanitize.js";

export const executionOutputMetaSchema = z.object({
  id: z.number().int().positive(),
  command: z.string().max(300),
  exitCode: z.number().int().nullable(),
  timestamp: z.string(),
  taskId: z.string().nullable(),
  iteration: z.number().int().nullable(),
  allowed: z.boolean(),
  reason: z.string().optional(),
  truncated: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
});

export type ExecutionOutputMeta = z.infer<typeof executionOutputMetaSchema>;

interface Store {
  nextId: number;
  items: ExecutionOutputMeta[];
}

function storeFile(workspaceId: string): string {
  return path.join(ensureDir(path.join(getStateDir(), "outputs")), `${workspaceId}.json`);
}

function bodyFile(workspaceId: string, id: number): string {
  return path.join(ensureDir(path.join(getStateDir(), "outputs", workspaceId)), `${id}.txt`);
}

function loadStore(workspaceId: string): Store {
  return readJsonIfExists<Store>(storeFile(workspaceId)) ?? { nextId: 1, items: [] };
}

function saveStore(workspaceId: string, store: Store): void {
  writeSecureJson(storeFile(workspaceId), store);
}

export interface RecordOutputInput {
  command: string;
  exitCode: number | null;
  output: string;
  taskId?: string | null;
  iteration?: number | null;
}

export function recordExecutionOutput(
  workspaceId: string,
  input: RecordOutputInput
): ExecutionOutputMeta {
  const store = loadStore(workspaceId);
  const sanitized = sanitizeOutput(input.output);
  const id = store.nextId;
  const meta: ExecutionOutputMeta = executionOutputMetaSchema.parse({
    id,
    command: input.command.slice(0, 300),
    exitCode: input.exitCode,
    timestamp: new Date().toISOString(),
    taskId: input.taskId ?? null,
    iteration: input.iteration ?? null,
    allowed: sanitized.allowed,
    ...(sanitized.reason ? { reason: sanitized.reason } : {}),
    truncated: sanitized.truncated,
    sizeBytes: sanitized.sizeBytes,
  });
  if (sanitized.allowed) {
    fs.writeFileSync(bodyFile(workspaceId, id), sanitized.text, { mode: 0o600 });
  }
  store.items.push(meta);
  store.nextId = id + 1;
  saveStore(workspaceId, store);
  return meta;
}

export function listExecutionOutputs(workspaceId: string, limit = 20): ExecutionOutputMeta[] {
  const store = loadStore(workspaceId);
  return store.items.slice(-Math.max(1, limit)).reverse();
}

export type ReadOutputResult =
  | { ok: true; meta: ExecutionOutputMeta; text: string }
  | { ok: false; error: "OUTPUT_RESTRICTED" | "NOT_FOUND" };

export function readExecutionOutput(workspaceId: string, id: number): ReadOutputResult {
  const store = loadStore(workspaceId);
  const meta = store.items.find((item) => item.id === id);
  if (!meta) return { ok: false, error: "NOT_FOUND" };
  if (!meta.allowed) return { ok: false, error: "OUTPUT_RESTRICTED" };
  const file = bodyFile(workspaceId, id);
  if (!fs.existsSync(file)) return { ok: false, error: "NOT_FOUND" };
  return { ok: true, meta, text: fs.readFileSync(file, "utf8") };
}

export function clearExecutionOutputs(workspaceId: string): void {
  try {
    fs.rmSync(storeFile(workspaceId), { force: true });
  } catch {
    // ignore
  }
}
