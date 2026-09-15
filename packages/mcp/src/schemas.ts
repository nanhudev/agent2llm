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
 * Zod output schemas for the read-only MCP data plane.
 *
 * Output schemas are declared explicitly (rather than inferred) so the set of
 * fields a Brain can see is reviewable in one file.
 */
import { z } from "zod";

export const gitIdentitySchema = z.object({
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  dirty: z.boolean(),
});

export const workspaceInfoSchema = {
  workspaceId: z.string(),
  workspaceName: z.string(),
  rootAlias: z.string(),
  projectType: z.string(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  packageManager: z.string().nullable(),
  scripts: z.record(z.string()),
  git: gitIdentitySchema,
};

export const listDirectorySchema = {
  path: z.string(),
  entries: z.array(
    z.object({ path: z.string(), type: z.enum(["file", "dir"]), sizeBytes: z.number().int().nonnegative().optional() })
  ),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
};

export const readFileSchema = {
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().nonnegative(),
  truncated: z.boolean(),
  remainingLines: z.number().int().nonnegative(),
  nextStartLine: z.number().int().positive().nullable(),
  content: z.string(),
};

export const searchSchema = {
  matches: z.array(z.object({ path: z.string(), line: z.number().int().nonnegative(), text: z.string() })),
  matchCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  engine: z.enum(["ripgrep", "node"]),
};

export const gitStatusSchema = {
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  staged: z.array(z.object({ path: z.string(), change: z.string() })),
  unstaged: z.array(z.object({ path: z.string(), change: z.string() })),
  untracked: z.array(z.string()),
  conflicted: z.array(z.string()),
  hidden: z.object({ changes: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative() }),
};

export const gitDiffSchema = {
  isRepo: z.boolean(),
  mode: z.enum(["unstaged", "staged", "head"]),
  totalBytes: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  returnedBytes: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable(),
  diff: z.string(),
};

export const testStatusSchema = {
  available: z.boolean(),
  message: z.string().optional(),
  taskId: z.string().optional(),
  iteration: z.number().int().nonnegative().optional(),
  tests: z.string().nullable().optional(),
  exitStatus: z.string().optional(),
  timestamp: z.string().optional(),
  outputAvailable: z.boolean().optional(),
  outputId: z.number().int().positive().nullable().optional(),
};

export const executionSummarySchema = {
  records: z.array(z.record(z.unknown())),
};

export const executionOutputSchema = {
  action: z.enum(["list", "read"]),
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        command: z.string(),
        exitCode: z.number().int().nullable(),
        timestamp: z.string(),
        taskId: z.string().nullable(),
        iteration: z.number().int().nullable(),
        readable: z.boolean(),
        status: z.enum(["readable", "restricted"]),
        truncated: z.boolean(),
        sizeBytes: z.number().int().nonnegative(),
      })
    )
    .optional(),
  id: z.number().int().positive().optional(),
  command: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  timestamp: z.string().optional(),
  truncated: z.boolean().optional(),
  text: z.string().optional(),
};

export const changedFilesSchema = {
  source: z.enum(["git", "snapshot", "unavailable"]),
  changed: z.number().int().nonnegative(),
  added: z.array(z.string()),
  modified: z.array(z.string()),
  deleted: z.array(z.string()),
  untracked: z.array(z.string()),
};

export const taskCheckpointSchema = {
  available: z.boolean(),
  sessionId: z.string().nullable(),
  taskId: z.string().nullable(),
  iteration: z.number().int().nonnegative().nullable(),
  protocolState: z.string().nullable(),
  goal: z.string().nullable(),
  progress: z.array(z.string()),
  knownIssues: z.array(z.string()),
  nextExpectedStep: z.string().nullable(),
};

export const listWorkspacesSchema = {
  workspaces: z.array(z.object({ id: z.string(), name: z.string(), exists: z.boolean() })),
  activeWorkspaceId: z.string(),
};

export const repositoryMetadataSchema = {
  workspaceId: z.string(),
  projectType: z.string(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  packageManager: z.string().nullable(),
  scripts: z.record(z.string()),
  git: gitIdentitySchema,
  fileCountEstimate: z.number().int().nonnegative(),
};
