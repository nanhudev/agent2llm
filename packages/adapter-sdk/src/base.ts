import { adapterUnavailable } from "@agent2llm/core";
import type { CapabilityManifest, ControlMessage } from "@agent2llm/protocol";
import type {
  AwaitOptions,
  BrainAdapter,
  BrainCheckpoint,
  BrainSession,
  BrainSessionContext,
  DetectionResult,
  DetectContext,
  ExecutionHandle,
  ExecutionRequest,
  HarnessAdapter,
  HarnessCheckpoint,
  HarnessEvent,
  HarnessSession,
  HarnessSessionContext,
  SetupContext,
  SetupResult,
  VerificationResult,
} from "./types.js";

export abstract class BaseAdapter {
  abstract metadata(): ReturnType<BrainAdapter["metadata"]>;
  abstract detect(ctx?: DetectContext): Promise<DetectionResult>;

  private manifestCache: CapabilityManifest | null = null;

  async capabilities(): Promise<CapabilityManifest> {
    if (!this.manifestCache) this.manifestCache = await this.buildCapabilities();
    return this.manifestCache;
  }

  protected abstract buildCapabilities(): Promise<CapabilityManifest>;

  async setup(_ctx: SetupContext): Promise<SetupResult> {
    return { ok: true, status: "configured", message: `${this.metadata().name} requires no setup.` };
  }

  /** Typed failure for a capability this adapter genuinely does not have. */
  protected unsupported(method: string): never {
    throw adapterUnavailable(
      `${this.metadata().id} does not implement ${method}; it is declared as unsupported in its capability manifest.`,
      { details: { adapterId: this.metadata().id, method } }
    );
  }
}

export abstract class BaseBrainAdapter extends BaseAdapter implements BrainAdapter {
  abstract createSession(ctx: BrainSessionContext): Promise<BrainSession>;
  abstract attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession>;
  abstract sendControl(session: BrainSession, message: ControlMessage): Promise<void>;
  abstract awaitControl(session: BrainSession, options?: AwaitOptions): Promise<ControlMessage>;
  abstract verifyWorkspace(
    session: BrainSession,
    workspace: { workspaceId: string; root: string }
  ): Promise<VerificationResult>;
  abstract close(session: BrainSession): Promise<void>;
}

export abstract class BaseHarnessAdapter extends BaseAdapter implements HarnessAdapter {
  abstract createSession(ctx: HarnessSessionContext): Promise<HarnessSession>;
  abstract attachSession(checkpoint: HarnessCheckpoint): Promise<HarnessSession>;
  abstract execute(session: HarnessSession, task: ExecutionRequest): Promise<ExecutionHandle>;
  abstract events(handle: ExecutionHandle): AsyncIterable<HarnessEvent>;
  abstract cancel(handle: ExecutionHandle): Promise<void>;
  abstract close(session: HarnessSession): Promise<void>;
}
