/**
 * Mock Brain.
 *
 * Exists ONLY in this package. It is the reference implementation used by the
 * orchestrator tests: scripted PLAN / REVIEW / DONE / REVISE / BLOCKED
 * responses, with a real in-memory conversation so protocol tests exercise the
 * same code path a web Brain would.
 */
import { emptyManifest, withCapabilities, type CapabilityManifest } from "@agent2llm/protocol";
import { createControlMessage, encodeControlMessage, parseControlBlock } from "@agent2llm/protocol";
import type { ControlMessage } from "@agent2llm/protocol";
import {
  BaseBrainAdapter,
  type AdapterMetadata,
  type BrainCheckpoint,
  type BrainSession,
  type BrainSessionContext,
  type DetectionResult,
  type SetupResult,
  type VerificationResult,
} from "@agent2llm/adapter-sdk";
import {
  DEFAULT_HANDS_SCRIPT,
  DEFAULT_RELAY_SCRIPT,
  WORKFLOW_RELAY,
  scriptFromEnvironment,
  type MockScriptStep,
} from "./scripts.js";

export type { MockScriptStep } from "./scripts.js";
export { scriptFromEnvironment } from "./scripts.js";

export interface MockBrainOptions {
  /** Consumed in order; the last step repeats once exhausted. */
  script?: MockScriptStep[];
  /** Force `verifyWorkspace` to fail (used by doctor/compat tests). */
  failVerification?: boolean;
}

interface MockState {
  cursor: number;
  inbox: ControlMessage[];
  sent: ControlMessage[];
  goal: string;
  /**
   * Did the INIT say this is a Relay run?
   *
   * Read from the `workflow:relay` constraint the orchestrator already sends,
   * because the two workflows need different default plans: Relay accepts a
   * NEXT_ACTION or a verdict, and the brain-hands plan opens with PLAN. A
   * default that ignored this would make the mock pair fail on the first round
   * of the workflow the product leads with.
   */
  relay: boolean;
  context: {
    sessionId: string;
    taskId: string;
    workspaceId: string;
  };
}

/**
 * Deterministic, dependency-free Brain. Nothing here touches the network,
 * the filesystem or a browser.
 */
export class MockBrainAdapter extends BaseBrainAdapter {
  private readonly states = new Map<string, MockState>();
  /**
   * A script someone actually asked for: constructor or environment.
   *
   * `null` means "no opinion", which is what lets the workflow pick the default
   * without ever overriding a caller's explicit choice.
   */
  private readonly providedScript: MockScriptStep[] | null;

  constructor(private readonly options: MockBrainOptions = {}) {
    super();
    // An explicit empty plan is never what someone meant: `awaitControl` would
    // have no step to hand back and the run would die on an index error inside
    // the loop, far from the line that caused it. Omit the option instead and
    // the workflow's own plan applies.
    if (options.script && options.script.length === 0) {
      throw new Error(
        "Mock brain: an explicit script must not be empty; omit it to use the workflow's default plan."
      );
    }
    // Precedence: an explicit script, then one from the environment. The
    // environment sits below the constructor so a test that passes a script is
    // never surprised by the machine it runs on.
    this.providedScript = options.script ?? scriptFromEnvironment() ?? null;
  }

  /** The plan this session follows: the caller's, or the one its workflow needs. */
  private scriptFor(state: MockState): MockScriptStep[] {
    if (this.providedScript) return this.providedScript;
    return state.relay ? DEFAULT_RELAY_SCRIPT : DEFAULT_HANDS_SCRIPT;
  }

  metadata(): AdapterMetadata {
    return {
      id: "mock-brain",
      name: "Mock Brain",
      version: "0.1.0",
      role: "brain",
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
      "git.inspect",
      "conversation.send",
      "conversation.receive",
      "plan.generate",
      "review.perform",
      "structuredOutput",
      "supportsHeadless",
    ]);
  }

  override async setup(): Promise<SetupResult> {
    return { ok: true, status: "verified", message: "Mock brain needs no setup." };
  }

  async createSession(ctx: BrainSessionContext): Promise<BrainSession> {
    this.states.set(ctx.sessionId, {
      cursor: 0,
      inbox: [],
      sent: [],
      goal: ctx.goal,
      relay: false,
      context: { sessionId: ctx.sessionId, taskId: ctx.taskId, workspaceId: ctx.workspaceId },
    });
    return { id: ctx.sessionId, adapterId: "mock-brain", ref: { sessionId: ctx.sessionId } };
  }

  async attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession> {
    const id = String(checkpoint.ref.sessionId ?? "mock");
    if (!this.states.has(id)) {
      this.states.set(id, {
        cursor: 0,
        inbox: [],
        sent: [],
        goal: String(checkpoint.ref.goal ?? ""),
        relay: false,
        context: {
          sessionId: id,
          taskId: String(checkpoint.ref.taskId ?? "mock-task"),
          workspaceId: String(checkpoint.ref.workspaceId ?? MOCK_WORKSPACE_ID),
        },
      });
    }
    return { id, adapterId: "mock-brain", ref: { sessionId: id } };
  }

  async sendControl(session: BrainSession, message: ControlMessage): Promise<void> {
    const state = this.require(session);
    // A real Brain answers in the identity of the message it just read. Caching
    // these at create time made the mock the only Brain that could not follow a
    // relay Pair across two runs: the conversation is reused, the task id is
    // not, and a reply quoting the previous run's task would be a protocol
    // violation rather than a continuation.
    state.context = {
      sessionId: message.sessionId,
      taskId: message.taskId,
      workspaceId: message.workspaceId,
    };
    if (message.type === "INIT") {
      // The orchestrator already says which workflow this is; the mock only has
      // to listen. `constraints` is schema-validated upstream, but this adapter
      // is the one place that must not throw on a surprise, so it reads
      // defensively and treats anything else as brain-hands.
      const constraints = message.payload.constraints;
      state.relay = Array.isArray(constraints) && constraints.includes(WORKFLOW_RELAY);
    }
    state.sent.push(message);
    // Round-trip through the wire format so the mock exercises the real parser.
    const reparsed = parseControlBlock(encodeControlMessage(message));
    if (!reparsed.ok) throw new Error(`Mock brain could not parse its own message: ${reparsed.error}`);
  }

  async awaitControl(session: BrainSession): Promise<ControlMessage> {
    const state = this.require(session);
    const last = state.sent[state.sent.length - 1];
    const iteration = last?.iteration ?? 0;
    const index = state.cursor++;
    const script = this.scriptFor(state);
    // Steps advance per awaited reply. The final step repeats so a REVISE loop
    // stays deterministic.
    const step = script[Math.min(index, script.length - 1)] ?? script[script.length - 1]!;
    return this.render(session, step, iteration);
  }

  async verifyWorkspace(
    _session: BrainSession,
    workspace: { workspaceId: string; root: string }
  ): Promise<VerificationResult> {
    return {
      verified: !this.options.failVerification,
      method: "mock",
      message: this.options.failVerification
        ? "Mock verification forced to fail."
        : `Mock brain can see workspace ${workspace.workspaceId}.`,
    };
  }

  async close(session: BrainSession): Promise<void> {
    this.states.delete(session.id);
  }

  /** Test helper: inspect what the orchestrator sent. */
  sentMessages(sessionId: string): ControlMessage[] {
    return this.states.get(sessionId)?.sent ?? [];
  }

  private contextFor(session: BrainSession): MockState["context"] {
    return this.require(session).context;
  }

  private render(session: BrainSession, step: MockScriptStep, iteration: number): ControlMessage {
    const base = {
      ...this.contextFor(session),
      iteration,
      sender: { role: "brain" as const, adapter: "mock-brain" },
    };
    switch (step.type) {
      case "INSPECTING":
        return createControlMessage("INSPECTING", { ...(step.focus ? { focus: step.focus } : {}) }, base);
      case "PLAN":
        return createControlMessage(
          "PLAN",
          {
            goal: this.states.get(session.id)?.goal ?? "mock goal",
            rationale: step.rationale ?? "mock rationale",
            actions: step.actions,
            filesLikelyInvolved: step.files ?? [],
            tests: "",
            successCriteria: step.successCriteria ?? "",
          },
          base
        );
      case "NEXT_ACTION":
        return createControlMessage(
          "NEXT_ACTION",
          { task: step.task, acceptance: step.acceptance ?? [], filesLikelyInvolved: step.files ?? [] },
          base
        );
      case "REVIEWING":
        return createControlMessage("REVIEWING", { ...(step.focus ? { focus: step.focus } : {}) }, base);
      case "DONE":
        return createControlMessage("DONE", { summary: step.summary }, base);
      case "REVISE":
        return createControlMessage(
          "REVISE",
          { reason: step.reason, requiredChanges: step.requiredChanges },
          base
        );
      case "BLOCKED":
        return createControlMessage("BLOCKED", { reason: step.reason, needs: step.needs ?? [] }, base);
      default:
        return createControlMessage("DONE", { summary: "mock" }, base);
    }
  }

  private require(session: BrainSession): MockState {
    let state = this.states.get(session.id);
    if (!state) {
      state = {
        cursor: 0,
        inbox: [],
        sent: [],
        goal: "",
        relay: false,
        context: { sessionId: session.id, taskId: "mock-task", workspaceId: MOCK_WORKSPACE_ID },
      };
      this.states.set(session.id, state);
    }
    return state;
  }
}

export function createMockBrain(options?: MockBrainOptions): MockBrainAdapter {
  return new MockBrainAdapter(options);
}

/** Re-exported so session ids in tests stay consistent with the orchestrator. */
export const MOCK_WORKSPACE_ID = "mock-workspace";
