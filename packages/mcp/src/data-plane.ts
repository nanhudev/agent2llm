/**
 * In-process read-only data plane.
 *
 * The same tool surface the MCP server exposes to web Brains, callable
 * directly. It exists so a Brain that is only an inference endpoint (the API
 * Brain) can still inspect the workspace instead of trusting the Harness.
 *
 * Every tool here goes through `Workspace`, so canonical path containment,
 * the sensitive-file deny list and the ignore rules apply unchanged. There is
 * deliberately no write, shell, commit or install tool — and none may be added.
 */
import { gitDiff, gitInfo, gitStatus, searchWorkspace, type Workspace } from "@agent2llm/workspace";
import { changedSinceLastSnapshot } from "@agent2llm/workspace";
import { latestExecutionRecord, listExecutionOutputs, readExecutionOutput, readExecutionRecords } from "@agent2llm/execution";
import type { DataPlaneCallResult, DataPlaneToolSpec, ReadOnlyDataPlane } from "@agent2llm/adapter-sdk";

const SCHEMA: Record<string, DataPlaneToolSpec> = {
  workspace_info: {
    name: "workspace_info",
    description: "Identity, project type, languages, frameworks, git state and scripts.",
    inputSchema: { type: "object", properties: {} },
  },
  list_directory: {
    name: "list_directory",
    description: "List entries under a workspace-relative path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "integer", minimum: 1, maximum: 4 },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
        offset: { type: "integer", minimum: 0 },
      },
    },
  },
  read_file: {
    name: "read_file",
    description: "Read a text file with line-range pagination. Sensitive files are denied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
  },
  search_workspace: {
    name: "search_workspace",
    description: "Search file contents. Returns path, line number and text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        regex: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  git_status: {
    name: "git_status",
    description: "Branch, staged/unstaged/untracked/conflicted files.",
    inputSchema: { type: "object", properties: {} },
  },
  git_diff: {
    name: "git_diff",
    description: "Git diff with byte-offset pagination.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["unstaged", "staged", "head"] },
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        max_bytes: { type: "integer", minimum: 1024, maximum: 262144 },
      },
    },
  },
  changed_files: {
    name: "changed_files",
    description: "What the last iteration changed (git, or a content-hash snapshot).",
    inputSchema: { type: "object", properties: {} },
  },
  test_status: {
    name: "test_status",
    description: "Tests and exit status of the most recent execution. Does NOT run tests.",
    inputSchema: { type: "object", properties: {} },
  },
  execution_summary: {
    name: "execution_summary",
    description: "Recent execution records reported by the Harness.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  execution_output: {
    name: "execution_output",
    description: "List or read command output the Harness released.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"] },
        id: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
};

const MAX_TEXT_BYTES = 32_000;

function ok(value: unknown): DataPlaneCallResult {
  const text = JSON.stringify(value, null, 2);
  return { ok: true, text: text.length > MAX_TEXT_BYTES ? `${text.slice(0, MAX_TEXT_BYTES)}\n…[truncated]` : text };
}

function deny(code: string, message: string): DataPlaneCallResult {
  return { ok: false, text: JSON.stringify({ error: code, message }) };
}

export function createInProcessDataPlane(workspace: Workspace): ReadOnlyDataPlane {
  return {
    tools: Object.values(SCHEMA),

    async call(name, args): Promise<DataPlaneCallResult> {
      try {
        switch (name) {
          case "workspace_info":
            return ok({
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              rootAlias: "workspace:/",
              ...workspace.detectProject(),
              git: gitInfo(workspace.root),
            });

          case "list_directory":
            return ok(
              await workspace.listDirectory(typeof args.path === "string" ? args.path : ".", {
                depth: typeof args.depth === "number" ? args.depth : 1,
                limit: typeof args.limit === "number" ? args.limit : 200,
                offset: typeof args.offset === "number" ? args.offset : 0,
              })
            );

          case "read_file": {
            if (typeof args.path !== "string") return deny("INVALID_ARGUMENTS", "read_file requires a string path");
            return ok(
              await workspace.readFile(args.path, {
                ...(typeof args.start_line === "number" ? { startLine: args.start_line } : {}),
                ...(typeof args.end_line === "number" ? { endLine: args.end_line } : {}),
              })
            );
          }

          case "search_workspace": {
            if (typeof args.query !== "string") return deny("INVALID_ARGUMENTS", "search_workspace requires query");
            return ok(
              await searchWorkspace(workspace, {
                query: args.query,
                ...(typeof args.path === "string" ? { path: args.path } : {}),
                ...(typeof args.glob === "string" ? { glob: args.glob } : {}),
                limit: typeof args.limit === "number" ? args.limit : 50,
                regex: args.regex === true,
              })
            );
          }

          case "git_status":
            return ok(gitStatus(workspace));

          case "git_diff": {
            const relPath = typeof args.path === "string" ? workspace.resolve(args.path).rel : undefined;
            return ok(
              gitDiff(
                workspace,
                {
                  mode: (args.mode === "staged" || args.mode === "head" ? args.mode : "unstaged") as
                    | "unstaged"
                    | "staged"
                    | "head",
                  offset: typeof args.offset === "number" ? args.offset : 0,
                  maxBytes: typeof args.max_bytes === "number" ? args.max_bytes : 65536,
                },
                relPath
              )
            );
          }

          case "changed_files": {
            const status = gitStatus(workspace);
            if (status.isRepo) {
              const modified = [...status.staged, ...status.unstaged].map((entry) => entry.path);
              return ok({
                source: "git",
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
            return ok({
              source: "snapshot",
              changed: diff.files.length,
              added: diff.added,
              modified: diff.modified,
              deleted: diff.deleted,
              untracked: [],
            });
          }

          case "test_status": {
            const latest = latestExecutionRecord(workspace.id);
            if (!latest) return ok({ available: false, message: "No execution records yet for this workspace." });
            return ok({
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

          case "execution_summary":
            return ok({
              records: readExecutionRecords(workspace.id, typeof args.limit === "number" ? args.limit : 5),
            });

          case "execution_output": {
            if (args.action === "read") {
              if (typeof args.id !== "number") return deny("INVALID_ARGUMENTS", "read requires id");
              const result = readExecutionOutput(workspace.id, args.id);
              if (!result.ok) {
                return result.error === "OUTPUT_RESTRICTED"
                  ? deny("OUTPUT_RESTRICTED", "This output was not released for the Brain to read.")
                  : deny("NOT_FOUND", `No execution output with id ${args.id}.`);
              }
              return ok({ ...result.meta, text: result.text });
            }
            return ok({
              action: "list",
              items: listExecutionOutputs(workspace.id, typeof args.limit === "number" ? args.limit : 20),
            });
          }

          default:
            return deny("UNKNOWN_TOOL", `No read-only tool named '${name}'.`);
        }
      } catch (error) {
        return deny("TOOL_FAILED", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
