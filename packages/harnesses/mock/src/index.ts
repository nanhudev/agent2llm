/**
 * Mock Harness — the only place in Agent2LLM where faking execution is
 * legitimate. It reproduces success, failure, timeout, partial execution,
 * changed files, test failures, approval prompts and session loss so the
 * orchestrator can be tested without any third-party product.
 */
import { emptyManifest, withCapabilities, type CapabilityManifest } from "@agent2llm/protocol";
import {
  BaseHarnessAdapter,
  type AdapterMetadata,
  type DetectionResult,
  type ExecutionHandle,
  type ExecutionRequest,
  type HarnessEvent,
  type HarnessSession,
} from "@agent2llm/adapter-sdk";

export type MockOutcome = "success" | "failure" | "timeout" | "partial" | "approval" | "session-loss";

export interface MockHarnessOptions {
  outcome?: MockOutcome;
  changedFiles?: string[];
  tests?: string | null;
  delayMs?: number;
}

const sessions = new Map<string, HarnessSession>();
const runs = new Map<string, ExecutionRequest>();

export class MockHarnessAdapter extends BaseHarnessAdapter {
  constructor(private readonly options: MockHarnessOptions = {}) {
    super();
  }

  metadata(): AdapterMetadata {
    return {
      id: "mock-harness",
      name: "Mock Harness",
      version: "0.1.0",
      role: "harness",
      experimental: false,
    };
  }

  async detect(): Promise<DetectionResult> {
    return { status: "verified", version: "0.1.0", reason: "Mock adapter, always available." };
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    return withCapabilities(emptyManifest("in-process"), [
      "session.create",
      "session.attach",
      "session.resume",
      "session.cancel",
      "workspace.read",
      "workspace.write",
      "shell.execute",
      "git.inspect",
      "git.modify",
      "task.execute",
      "stream.events",
      "supportsHeadless",
    ]);
  }

  async createSession(): Promise<HarnessSession> {
    const session: HarnessSession = {
      id: `mock-harness-${Date.now()}`,
      adapterId: "mock-harness",
      ref: {},
    };
    sessions.set(session.id, session);
    return session;
  }

  async attachSession(checkpoint: { adapterId: string; ref: Record<string, unknown> }): Promise<HarnessSession> {
    const id = String(checkpoint.ref.sessionId ?? `mock-harness-${Date.now()}`);
    const session: HarnessSession = { id, adapterId: "mock-harness", ref: checkpoint.ref };
    sessions.set(id, session);
    return session;
  }

  async execute(_session: HarnessSession, task: ExecutionRequest): Promise<ExecutionHandle> {
    const id = `mock-exec-${task.taskId}-${task.iteration}-${Date.now()}`;
    runs.set(id, task);
    return { id, adapterId: "mock-harness", ref: { taskId: task.taskId } };
  }

  async *events(handle: ExecutionHandle): AsyncIterable<HarnessEvent> {
    const outcome = this.options.outcome ?? "success";
    const now = () => new Date().toISOString();
    yield { type: "started", at: now(), handleId: handle.id };
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));

    if (outcome === "approval") {
      yield { type: "approval-required", at: now(), message: "Mock harness needs approval to continue." };
    }
    if (outcome === "session-loss") {
      yield {
        type: "failed",
        at: now(),
        error: { code: "SessionLost", message: "Mock harness lost its session." },
      };
      return;
    }
    if (outcome === "timeout") {
      yield { type: "progress", at: now(), percent: 50, message: "still working" };
      yield { type: "failed", at: now(), error: { code: "Timeout", message: "Mock harness timed out." } };
      return;
    }
    if (outcome === "failure") {
      yield { type: "log", at: now(), message: "npm test exited with code 1" };
      yield { type: "failed", at: now(), error: { code: "ExecutionFailed", message: "Mock execution failed." } };
      return;
    }

    const files = this.options.changedFiles ?? ["src/index.ts"];
    yield { type: "changed", at: now(), files };
    if (outcome === "partial") {
      yield { type: "progress", at: now(), percent: 60, message: "stopped early" };
      yield {
        type: "failed",
        at: now(),
        error: { code: "ExecutionFailed", message: "Mock harness stopped before finishing." },
      };
      return;
    }
    yield {
      type: "completed",
      at: now(),
      result: {
        ok: true,
        exitStatus: "ok",
        changedFiles: files,
        tests: this.options.tests ?? "12 passed",
        summary: `Executed ${files.length} change(s).`,
        commands: [],
        durationMs: 1,
      },
    };
  }

  async cancel(): Promise<void> {
    // Idempotent by contract.
  }

  async close(session: HarnessSession): Promise<void> {
    sessions.delete(session.id);
  }

  static reset(): void {
    sessions.clear();
    runs.clear();
  }
}

export function createMockHarness(options?: MockHarnessOptions): MockHarnessAdapter {
  return new MockHarnessAdapter(options);
}
