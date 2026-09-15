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
 * Workspace reading tools: identity, listing, file reads and search.
 *
 * Every tool is read-only and scope-checked. Paths are workspace-relative and
 * resolved through `Workspace`, so absolute paths and escapes never reach the
 * filesystem layer.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gitInfo, searchWorkspace } from "@agent2llm/workspace";
import type { AuthInfo } from "@agent2llm/auth";
import type { McpContext } from "../context.js";
import { UNTRUSTED_NOTE, mapError, okStructured, requireScope, type ToolResult } from "../result.js";
import {
  listDirectorySchema,
  listWorkspacesSchema,
  readFileSchema,
  repositoryMetadataSchema,
  searchSchema,
  workspaceInfoSchema,
} from "../schemas.js";

export function registerWorkspaceTools(server: McpServer, ctx: McpContext): void {
  const { workspace } = ctx;

  server.registerTool(
    "workspace_info",
    {
      title: "Workspace info",
      description:
        `Identity, project type, languages, frameworks, git state and scripts for the connected workspace. Call this first. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: workspaceInfoSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.read");
      if (denied) return denied;
      try {
        const project = workspace.detectProject();
        const git = gitInfo(workspace.root);
        return okStructured({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rootAlias: "workspace:/",
          ...project,
          git,
        });
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: `Workspaces registered with this Agent2LLM installation. Ids are opaque; paths are never exposed. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: listWorkspacesSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.read");
      if (denied) return denied;
      const workspaces = ctx.registry
        ? ctx.registry.list().map((entry) => ({ id: entry.id, name: entry.name, exists: entry.exists }))
        : [{ id: workspace.id, name: workspace.name, exists: true }];
      return okStructured({ workspaces, activeWorkspaceId: workspace.id });
    }
  );

  server.registerTool(
    "list_directory",
    {
      title: "List directory",
      description: `List files and directories under a workspace-relative path (noise dirs omitted, paginated). ${UNTRUSTED_NOTE}`,
      inputSchema: {
        path: z.string().default(".").describe("Workspace-relative path, e.g. 'src'"),
        depth: z.number().int().min(1).max(4).default(1),
        limit: z.number().int().min(1).max(1000).default(200),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: listDirectorySchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.read");
      if (denied) return denied;
      try {
        return okStructured(await workspace.listDirectory(args.path, args));
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description: `Read a text file with line-range pagination. Sensitive files (.env, keys, credentials) are always denied. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      },
      outputSchema: readFileSchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.read");
      if (denied) return denied;
      try {
        return okStructured(
          await workspace.readFile(args.path, { startLine: args.start_line, endLine: args.end_line })
        );
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "search_workspace",
    {
      title: "Search workspace",
      description: `Search file contents (ripgrep when available). Returns path, line number and text. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        query: z.string().min(2),
        path: z.string().optional(),
        glob: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        regex: z.boolean().default(false),
      },
      outputSchema: searchSchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.search");
      if (denied) return denied;
      try {
        return okStructured(await searchWorkspace(workspace, args));
      } catch (error) {
        return mapError(error);
      }
    }
  );

  server.registerTool(
    "repository_metadata",
    {
      title: "Repository metadata",
      description: `Project metadata used by the Brain to orient itself: languages, frameworks, scripts, git identity. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: repositoryMetadataSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "workspace.read");
      if (denied) return denied;
      try {
        const project = workspace.detectProject();
        const listing = await workspace.listDirectory(".", { depth: 3, limit: 1000 });
        return okStructured({
          workspaceId: workspace.id,
          ...project,
          git: gitInfo(workspace.root),
          fileCountEstimate: listing.total,
        });
      } catch (error) {
        return mapError(error);
      }
    }
  );
}
