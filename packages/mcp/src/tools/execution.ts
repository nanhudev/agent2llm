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
 * Execution evidence tools.
 *
 * The Brain reviews the run through these: what the Harness claims happened,
 * which outputs it released, and the local task checkpoint. Nothing here
 * executes anything.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  latestExecutionRecord,
  listExecutionOutputs,
  readExecutionOutput,
  readExecutionRecords,
} from "@agent2llm/execution";
import type { AuthInfo } from "@agent2llm/auth";
import type { McpContext } from "../context.js";
import { UNTRUSTED_NOTE, fail, okStructured, requireScope, type ToolResult } from "../result.js";
import { executionOutputSchema, executionSummarySchema, taskCheckpointSchema, testStatusSchema } from "../schemas.js";

export function registerExecutionTools(server: McpServer, ctx: McpContext): void {
  const { workspace } = ctx;

  server.registerTool(
    "test_status",
    {
      title: "Test status",
      description: `Summary of the most recent execution reported by the Harness. This does NOT run tests. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: testStatusSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "execution.read");
      if (denied) return denied;
      const latest = latestExecutionRecord(workspace.id);
      if (!latest) {
        return okStructured({ available: false, message: "No execution records yet for this workspace." });
      }
      return okStructured({
        available: true,
        taskId: latest.taskId,
        iteration: latest.iteration,
        tests: latest.tests,
        exitStatus: latest.exitStatus,
        timestamp: latest.timestamp,
        outputAvailable: Boolean(latest.outputAvailable),
        outputId: latest.outputId ?? null,
      });
    }
  );

  server.registerTool(
    "execution_summary",
    {
      title: "Execution summary",
      description: `Recent execution records: task id, iteration, changed files, tests, exit status. ${UNTRUSTED_NOTE}`,
      inputSchema: { limit: z.number().int().min(1).max(50).default(5) },
      outputSchema: executionSummarySchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "execution.read");
      if (denied) return denied;
      return okStructured({
        records: readExecutionRecords(workspace.id, args.limit) as unknown as Record<string, unknown>[],
      });
    }
  );

  server.registerTool(
    "execution_output",
    {
      title: "Execution output",
      description: `List or read command output the Harness released (action=list, then action=read with an id). Restricted items have no body. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        action: z.enum(["list", "read"]).default("list"),
        id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      outputSchema: executionOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "execution.read");
      if (denied) return denied;
      if (args.action === "list") {
        const items = listExecutionOutputs(workspace.id, args.limit).map((item) => ({
          id: item.id,
          command: item.command,
          exitCode: item.exitCode,
          timestamp: item.timestamp,
          taskId: item.taskId ?? null,
          iteration: item.iteration ?? null,
          readable: item.allowed,
          status: item.allowed ? ("readable" as const) : ("restricted" as const),
          truncated: item.truncated,
          sizeBytes: item.sizeBytes,
        }));
        return okStructured({ action: "list" as const, items });
      }
      if (args.id === undefined) return fail("INVALID_ARGUMENTS", "read requires id");
      const result = readExecutionOutput(workspace.id, args.id);
      if (!result.ok) {
        return result.error === "OUTPUT_RESTRICTED"
          ? fail("OUTPUT_RESTRICTED", "This output was not released for the Brain to read.")
          : fail("NOT_FOUND", `No execution output with id ${args.id}.`);
      }
      return okStructured({
        action: "read" as const,
        id: result.meta.id,
        command: result.meta.command,
        exitCode: result.meta.exitCode,
        timestamp: result.meta.timestamp,
        truncated: result.meta.truncated,
        text: result.text,
      });
    }
  );

  server.registerTool(
    "task_checkpoint",
    {
      title: "Task checkpoint",
      description: `Local checkpoint for the current collaboration: goal, progress, known issues, next expected step. ${UNTRUSTED_NOTE}`,
      inputSchema: {},
      outputSchema: taskCheckpointSchema,
      annotations: { readOnlyHint: true },
    },
    async (_args, extra): Promise<ToolResult> => {
      const denied = requireScope(extra.authInfo as AuthInfo | undefined, "execution.read");
      if (denied) return denied;
      const sessionId = ctx.sessionId;
      const session = sessionId ? ctx.sessions?.get(sessionId) ?? null : null;
      if (!session) {
        return okStructured({
          available: false,
          sessionId: sessionId ?? null,
          taskId: null,
          iteration: null,
          protocolState: null,
          goal: null,
          progress: [],
          knownIssues: [],
          nextExpectedStep: null,
        });
      }
      return okStructured({
        available: true,
        sessionId: session.sessionId,
        taskId: session.taskId,
        iteration: session.iteration,
        protocolState: session.protocolState,
        goal: session.checkpoint?.goal ?? session.goal,
        progress: session.checkpoint?.progress ?? [],
        knownIssues: session.checkpoint?.knownIssues ?? [],
        nextExpectedStep: session.checkpoint?.nextExpectedStep ?? null,
      });
    }
  );
}
