/**
 * The public shapes of the brain-hands workflow.
 *
 * Kept apart from `runner.ts` so the runtime reads as one thing: a constructor
 * and a loop. These three interfaces are what callers — the CLI, the doctor,
 * tests — are allowed to depend on.
 */
import type { A2LState } from "@agent2llm/protocol";
import type { EventSink, PermissionPolicy } from "@agent2llm/core";
import type {
  AdapterRegistry,
  ReadOnlyDataPlane,
  UserActionRequest,
} from "@agent2llm/adapter-sdk";
import type { SessionStore } from "@agent2llm/session";
import type { Logger } from "@agent2llm/logger";

export interface OrchestratorDeps {
  registry: AdapterRegistry;
  sessions: SessionStore;
  workspaceId: string;
  workspaceRoot: string;
  logger?: Logger;
  emit?: EventSink;
  policy?: PermissionPolicy;
  /** Ask the human for exactly one action, then continue. */
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
  /** Abort the run (Ctrl-C, session stop). */
  signal?: AbortSignal;
  /**
   * Read-only workspace surface handed to Brains that cannot reach MCP
   * themselves (for example an API Brain). Optional by design.
   */
  dataPlane?: ReadOnlyDataPlane;
}

export interface RunOptions {
  goal: string;
  brainId: string;
  harnessId: string;
  workflowId?: string;
  sessionId?: string;
  maxIterations?: number;
  /** Resolve adapter setup without contacting any external product. */
  dryRun?: boolean;
  /**
   * Proceed even when an adapter *measured* that it is not authenticated.
   * Distinct from the unknown case, which already warns its way through: this is
   * for a user who knows better than the measurement.
   */
  ignoreAuth?: boolean;
}

export interface RunResult {
  sessionId: string;
  taskId: string;
  state: A2LState;
  iterations: number;
  summary: string;
}
