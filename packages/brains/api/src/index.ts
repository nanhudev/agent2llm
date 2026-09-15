/**
 * Generic API Brain.
 *
 * Not the product's core (Agent2LLM is about decoupling a *thinking client*
 * from a *harness*), but a genuinely useful supplement and the reference
 * implementation for "a Brain that is just an inference endpoint".
 *
 * It has NO workspace access of its own beyond what the caller supplies: API
 * brains read the workspace through the same MCP data plane when a bridge is
 * paired, otherwise they reason from the control message alone and say so.
 */
import { emptyManifest, withCapabilities, type CapabilityManifest } from "@agent2llm/protocol";
import { encodeControlMessage, parseControlBlock } from "@agent2llm/protocol";
import type { ControlMessage } from "@agent2llm/protocol";
import {
  BaseBrainAdapter,
  type AdapterMetadata,
  type BrainCheckpoint,
  type BrainSession,
  type BrainSessionContext,
  type DetectionResult,
  type ReadOnlyDataPlane,
  type SetupContext,
  type SetupResult,
  type VerificationResult,
} from "@agent2llm/adapter-sdk";
import { createOpenAiCompatibleProvider, type BrainProvider, type ChatTurn } from "./providers.js";

interface ApiSessionState {
  provider: BrainProvider;
  history: ChatTurn[];
}

const sessions = new Map<string, ApiSessionState>();

/** How many tool rounds a single control reply may spend inspecting. */
const MAX_TOOL_ROUNDS = 12;

export interface ApiBrainOptions {
  provider?: BrainProvider;
  model?: string;
}

export class ApiBrain extends BaseBrainAdapter {
  private readonly provider: BrainProvider;
  private dataPlane: ReadOnlyDataPlane | null = null;

  constructor(options: ApiBrainOptions = {}) {
    super();
    this.provider = options.provider ?? createOpenAiCompatibleProvider({ ...(options.model ? { model: options.model } : {}) });
  }

  /**
   * Supplies the read-only workspace surface.
   *
   * Must be attached before `capabilities()`: whether this Brain can inspect
   * the workspace — and therefore whether independent review is possible —
   * depends entirely on it.
   */
  attachDataPlane(dataPlane: ReadOnlyDataPlane): void {
    this.dataPlane = dataPlane;
  }

  private get canInspect(): boolean {
    return this.dataPlane !== null && this.provider.supportsTools;
  }

  metadata(): AdapterMetadata {
    return {
      id: "api",
      name: "API Provider",
      version: "0.1.0",
      role: "brain",
      vendor: this.provider.displayName,
      experimental: false,
    };
  }

  async detect(): Promise<DetectionResult> {
    const env = this.provider.credentialEnv;
    const present = Boolean(process.env[env]);
    return present
      ? { status: "configured", reason: `${env} is set; provider '${this.provider.id}' is usable.` }
      : {
          status: "implemented",
          reason: `${env} is not set. Set it to use the API Brain.`,
          notes: ["Credentials are read from the environment only; never written to disk by Agent2LLM."],
        };
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const inspect = this.canInspect;
    const base = withCapabilities(emptyManifest("http"), [
      "session.create",
      "session.attach",
      "session.resume",
      "session.cancel",
      "conversation.send",
      "conversation.receive",
      "plan.generate",
      "review.perform",
      "structuredOutput",
      "supportsHeadless",
      ...(inspect ? (["workspace.read"] as const) : []),
    ]);
    return {
      ...base,
      limitations: inspect
        ? [
            "Workspace access is limited to the read-only data plane tools.",
            "Cost and latency depend entirely on the configured provider.",
          ]
        : [
            "No workspace access: attach a data plane and use a provider with tool calling, otherwise reviews are not independent.",
            ...(this.provider.supportsTools
              ? []
              : [`Provider '${this.provider.id}' does not expose tool calling in this implementation.`]),
            "Cost and latency depend entirely on the configured provider.",
          ],
      auth: {
        required: true,
        authenticated: Boolean(process.env[this.provider.credentialEnv]),
        method: `${this.provider.credentialEnv} environment variable`,
      },
      facts: {
        provider: this.provider.id,
        model: this.provider.defaultModel,
        dataPlane: inspect ? "attached" : "none",
      },
    };
  }

  override async setup(ctx: SetupContext): Promise<SetupResult> {
    if (!process.env[this.provider.credentialEnv]) {
      return {
        ok: false,
        status: "configured",
        message: `Set ${this.provider.credentialEnv} before using the API Brain.`,
      };
    }
    return { ok: true, status: "configured", message: `Using provider '${this.provider.id}'.`, data: { workspaceId: ctx.workspaceId } };
  }

  async createSession(ctx: BrainSessionContext): Promise<BrainSession> {
    sessions.set(ctx.sessionId, { provider: this.provider, history: [] });
    return { id: ctx.sessionId, adapterId: "api", ref: { provider: this.provider.id } };
  }

  async attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession> {
    const id = String(checkpoint.ref.sessionId ?? `api-${Date.now()}`);
    sessions.set(id, {
      provider: this.provider,
      history: Array.isArray(checkpoint.ref.history) ? (checkpoint.ref.history as ChatTurn[]) : [],
    });
    return { id, adapterId: "api", ref: { provider: this.provider.id } };
  }

  async sendControl(session: BrainSession, message: ControlMessage): Promise<void> {
    const state = this.stateFor(session);
    state.history.push({ role: "user", content: encodeControlMessage(message) });
  }

  async awaitControl(session: BrainSession): Promise<ControlMessage> {
    const state = this.stateFor(session);
    const systemPrompt = [
      "You are the BRAIN in an Agent2LLM collaboration. You do not execute changes.",
      ...(this.canInspect
        ? [
            "Inspect the workspace with the provided read-only tools before deciding.",
            "Never trust the Harness's own report of what changed; verify it yourself.",
          ]
        : ["You have no workspace access, so say so rather than guessing at file contents."]),
      "Finish with exactly one [A2L] control block and nothing else.",
    ].join("\n");

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await state.provider.complete({
        model: state.provider.defaultModel,
        messages: [{ role: "system", content: systemPrompt }, ...state.history],
        ...(this.canInspect && this.dataPlane ? { tools: this.dataPlane.tools } : {}),
      });

      if (response.toolCalls && response.toolCalls.length > 0 && this.dataPlane) {
        await this.runToolCalls(state, response.toolCalls);
        continue;
      }

      const parsed = parseControlBlock(response.text);
      if (parsed.ok) {
        state.history.push({ role: "assistant", content: response.text });
        return parsed.message;
      }
      state.history.push({
        role: "user",
        content: "Your reply contained no valid [A2L] block. Reply with one control block only.",
      });
    }
    throw new Error("API Brain failed to produce a valid A2L control message after 3 attempts.");
  }

  /**
   * Executes requested read-only tools and feeds results back.
   *
   * Unknown or failing tools come back as an error string rather than an
   * exception, so a bad model guess cannot abort the run.
   */
  private async runToolCalls(
    state: ApiSessionState,
    calls: readonly { id: string; name: string; arguments: string }[]
  ): Promise<void> {
    const dataPlane = this.dataPlane;
    if (!dataPlane) return;
    state.history.push({ role: "assistant", content: `[tool request] ${calls.map((c) => c.name).join(", ")}` });
    const results: string[] = [];
    for (const call of calls.slice(0, MAX_TOOL_ROUNDS)) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.arguments || "{}");
        if (typeof parsed === "object" && parsed !== null) args = parsed as Record<string, unknown>;
      } catch {
        results.push(`${call.name}: invalid arguments JSON`);
        continue;
      }
      const result = await dataPlane.call(call.name, args);
      results.push(`${call.name}: ${result.text}`);
    }
    state.history.push({ role: "user", content: results.join("\n\n") });
  }

  async verifyWorkspace(
    _session: BrainSession,
    workspace: { workspaceId: string; root: string }
  ): Promise<VerificationResult> {
    if (!this.canInspect || !this.dataPlane) {
      return {
        verified: false,
        method: "none",
        message: `The API Brain has no workspace access. Attach a read-only data plane for workspace ${workspace.workspaceId} to enable independent review.`,
      };
    }
    const probe = await this.dataPlane.call("workspace_info", {});
    return {
      verified: probe.ok,
      method: "data-plane",
      message: probe.ok
        ? `API Brain can read workspace ${workspace.workspaceId} through ${this.dataPlane.tools.length} read-only tools.`
        : `Workspace probe failed: ${probe.text.slice(0, 300)}`,
    };
  }

  async close(session: BrainSession): Promise<void> {
    sessions.delete(session.id);
  }

  private stateFor(session: BrainSession): ApiSessionState {
    let state = sessions.get(session.id);
    if (!state) {
      state = { provider: this.provider, history: [] };
      sessions.set(session.id, state);
    }
    return state;
  }
}

export function createApiBrain(options?: ApiBrainOptions): ApiBrain {
  return new ApiBrain(options);
}

export * from "./providers.js";
