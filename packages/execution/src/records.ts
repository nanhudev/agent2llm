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
 * Execution records — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/execution/records.ts
 *   changes:  added adapterId/workspace-scoped artifact refs, JSONL format and
 *             size caps preserved.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureDir, getStateDir } from "@agent2llm/config";

export const executionRecordSchema = z.object({
  taskId: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  changedFiles: z.union([z.array(z.string().max(300)), z.number().int().nonnegative()]),
  tests: z.string().max(300).nullable(),
  exitStatus: z.string().max(60),
  timestamp: z.string(),
  adapterId: z.string().max(64).optional(),
  commands: z.array(z.string().max(200)).max(20).default([]),
  notes: z.string().max(1000).optional(),
  outputId: z.number().int().positive().optional(),
  outputAvailable: z.boolean().optional(),
  artifactRefs: z.array(z.string().max(200)).max(20).default([]),
});

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export function recordsFile(workspaceId: string): string {
  const dir = ensureDir(path.join(getStateDir(), "executions"));
  return path.join(dir, `${workspaceId}.jsonl`);
}

export function appendExecutionRecord(workspaceId: string, record: ExecutionRecord): ExecutionRecord {
  const parsed = executionRecordSchema.parse(record);
  fs.appendFileSync(recordsFile(workspaceId), `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
  return parsed;
}

export function readExecutionRecords(workspaceId: string, limit = 10): ExecutionRecord[] {
  const file = recordsFile(workspaceId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  const records: ExecutionRecord[] = [];
  const requested = Math.max(1, Math.floor(limit));
  for (let index = lines.length - 1; index >= 0 && records.length < requested; index--) {
    try {
      const parsed = executionRecordSchema.safeParse(JSON.parse(lines[index]!));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // skip corrupt lines
    }
  }
  return records.reverse();
}

export function latestExecutionRecord(workspaceId: string): ExecutionRecord | null {
  const records = readExecutionRecords(workspaceId, 1);
  return records[records.length - 1] ?? null;
}

export function recordsForTask(workspaceId: string, taskId: string): ExecutionRecord[] {
  return readExecutionRecords(workspaceId, 200).filter((record) => record.taskId === taskId);
}

export function clearExecutionRecords(workspaceId: string): void {
  try {
    fs.rmSync(recordsFile(workspaceId), { force: true });
  } catch {
    // ignore
  }
}
