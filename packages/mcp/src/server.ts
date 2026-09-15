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
 * Read-only MCP data plane.
 *
 * This is the ONLY surface a Brain gets on the workspace. There is no
 * write_file, no shell, no commit, no install — those tools do not exist,
 * so no prompt injection or scope bug can enable them.
 *
 * The tool set is assembled from three groups so each stays reviewable:
 * workspace reads, git inspection, and execution evidence.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context.js";
import { UNTRUSTED_NOTE } from "./result.js";
import { registerExecutionTools } from "./tools/execution.js";
import { registerGitTools } from "./tools/git.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

export type { McpContext } from "./context.js";

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "agent2llm", version: ctx.version },
    { capabilities: { tools: {} }, instructions: UNTRUSTED_NOTE }
  );

  registerWorkspaceTools(server, ctx);
  registerGitTools(server, ctx);
  registerExecutionTools(server, ctx);

  return server;
}
