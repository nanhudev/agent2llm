/**
 * The only state a tool group receives.
 *
 * Deliberately narrow: no filesystem paths, no credentials. Adapters and
 * transports are not reachable from here, so a compromised tool cannot pivot
 * into the control plane.
 */
import type { Logger } from "@agent2llm/logger";
import type { SessionStore } from "@agent2llm/session";
import type { Workspace, WorkspaceRegistry } from "@agent2llm/workspace";

export interface McpContext {
  workspace: Workspace;
  logger: Logger;
  version: string;
  registry?: WorkspaceRegistry;
  sessions?: SessionStore;
  sessionId?: string;
}
