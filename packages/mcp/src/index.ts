export * from "./server.js";
export * from "./http.js";
export * from "./data-plane.js";

/** The Brain-facing tool surface. Mutation tools must never appear here. */
export const READ_ONLY_MCP_TOOLS = [
  "list_workspaces",
  "workspace_info",
  "list_directory",
  "read_file",
  "search_workspace",
  "git_status",
  "git_diff",
  "changed_files",
  "test_status",
  "execution_summary",
  "execution_output",
  "task_checkpoint",
  "repository_metadata",
] as const;

export const FORBIDDEN_MCP_TOOLS = [
  "write_file",
  "delete_file",
  "apply_patch",
  "shell",
  "run_command",
  "git_commit",
  "git_push",
  "install_package",
] as const;
