/**
 * Minimal custom Harness adapter.
 *
 * Publish as `@agent2llm/harness-my-harness` with an `apiVersion` in the
 * package manifest, then every existing Brain composes with it automatically.
 */
import { HarnessAdapterBase } from "@agent2llm/adapter-sdk";
import type {
  ExecutionHandle,
  ExecutionRequest,
  HarnessEvent,
  HarnessSession,
  HarnessSessionContext,
  CapabilityManifest,
  SetupResult,
} from "@agent2llm/adapter-sdk";

export class MyHarnessAdapter extends HarnessAdapterBase {
  metadata() {
    return {
      id: "my-harness",
      name: "My Harness",
      version: "0.1.0",
      role: "harness" as const,
    };
  }

  override async capabilities(): Promise<CapabilityManifest> {
    // Only claim what the tool actually does. Missing capabilities are fine.
    return this.emptyManifestFor("subprocess", [
      "session.create",
      "task.execute",
      "workspace.read",
      "workspace.write",
    ]);
  }

  override async setup(): Promise<SetupResult> {
    return { ok: true, status: "configured" };
  }

  override async createSession(ctx: HarnessSessionContext): Promise<HarnessSession> {
    return { id: ctx.sessionId, adapterId: this.metadata().id, ref: { sessionId: ctx.sessionId } };
  }

  override async execute(session: HarnessSession, task: ExecutionRequest): Promise<ExecutionHandle> {
    // Really run the tool. Never return a fabricated success.
    void task;
    return { id: `${session.id}:1`, adapterId: this.metadata().id };
  }

  override async *events(_handle: ExecutionHandle): AsyncIterable<HarnessEvent> {
    yield { type: "completed", result: { ok: true, summary: "done", changedFiles: 0, exitStatus: "ok" } };
  }

  override async cancel(_handle: ExecutionHandle): Promise<void> {
    // Cancel is always safe to call.
  }
}
