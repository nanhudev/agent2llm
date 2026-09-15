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
 * Git inspection tools.
 *
 * These exist so the Brain can independently verify what actually changed
 * instead of trusting the Harness's own report. Non-git workspaces fall back to
 * a content-hash snapshot rather than failing.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { changedSinceLastSnapshot, gitDiff, gitStatus } from "@agent2llm/workspace";
import type { AuthInfo } from "@agent2llm/auth";
import type { McpContext } from "../context.js";
import { UNTRUSTED_NOTE, mapError, okStructured, requireScope, type ToolResult } from "../result.js";
import { changedFilesSchema, gitDiffSchema, gitStatusSchema } from "../schemas.js";

export function registerGitTools(server: McpServer, ctx: McpContext): void {
  const { workspace } = ctx;

  server.registerTool(
    "git_status",
    {
      title: "Git status",
      description: `Structured git status: branch, staged/unstaged/untracked/conflicted files. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: gitStatusSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "git.read");
      if (denied) return denied;
      try {
        return okStructured(gitStatus(workspace));
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "git_diff",
    {
      title: "Git diff",
      description: `Git diff with byte-offset pagination (unstaged | staged | head). ${UNTRUSTED_NOTE}`,
      inputSchema: {
        mode: z.enum(["unstaged", "staged", "head"]).default("unstaged"),
        path: z.string().optional(),
        offset: z.number().int().min(0).default(0),
        max_bytes: z.number().int().min(1024).max(262144).default(65536),
      },
      outputSchema: gitDiffSchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "git.read");
      if (denied) return denied;
      try {
        const relPath = args.path ? workspace.resolve(args.path).rel : undefined;
        return okStructured(
          gitDiff(workspace, { mode: args.mode, offset: args.offset, maxBytes: args.max_bytes }, relPath)
        );
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "changed_files",
    {
      title: "Changed files",
      description: `What the last iteration changed. Uses git when available, otherwise a content-hash snapshot. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: changedFilesSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "git.read");
      if (denied) return denied;
      try {
        const status = gitStatus(workspace);
        if (status.isRepo) {
          const modified = [...status.staged, ...status.unstaged].map((entry) => entry.path);
          return okStructured({
            source: "git" as const,
            changed: modified.length + status.untracked.length,
            added: status.staged.filter((entry) => entry.change === "added").map((entry) => entry.path),
            modified,
            deleted: [...status.staged, ...status.unstaged]
              .filter((entry) => entry.change === "deleted")
              .map((entry) => entry.path),
            untracked: status.untracked,
          });
        }
        const diff = changedSinceLastSnapshot(workspace);
        return okStructured({
          source: "snapshot" as const,
          changed: diff.files.length,
          added: diff.added,
          modified: diff.modified,
          deleted: diff.deleted,
          untracked: [],
        });
      } catch (error) {
        return mapError(error);
      }
    }
  );
}
