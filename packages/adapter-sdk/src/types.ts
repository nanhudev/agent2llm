import type { CapabilityManifest, AdapterStatus, ControlMessage } from "@agent2llm/protocol";

export type AdapterRole = "brain" | "harness";

export interface AdapterMetadata {
  /** Stable id used on the CLI, e.g. `chatgpt-web`. */
  id: string;
  /** Human name, e.g. `ChatGPT`. */
  name: string;
  /** Adapter version (not the vendor product version). */
  version: string;
  role: AdapterRole;
  vendor?: string;
  homepage?: string;
  experimental?: boolean;
  /** Product/binary this adapter drives, if any. */
  drives?: string;
}

export interface DetectContext {
  logger?: unknown;
  /** Skip version probing (fast path used by `agent2llm detect`). */
  quick?: boolean;
}

export interface DetectionResult {
  status: AdapterStatus;
  /** Absolute path to the driving binary, when the adapter has one. */
  binaryPath?: string;
  version?: string | null;
  reason?: string;
  notes?: string[];
}

export interface SetupContext {
  workspaceId: string;
  workspaceRoot: string;
  sessionId?: string;
  options?: Record<string, unknown>;
  /** The adapter asks the user for exactly ONE action at a time. */
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

/**
 * A read-only view of the workspace, expressed as callable tools.
 *
 * Web brains reach the same surface over MCP; a Brain that is "just an
 * inference endpoint" gets it in-process. Either way the surface is the same
 * and it has no mutation tools.
 */
export interface DataPlaneToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DataPlaneCallResult {
  ok: boolean;
  text: string;
}

export interface ReadOnlyDataPlane {
  readonly tools: readonly DataPlaneToolSpec[];
  call(name: string, args: Record<string, unknown>): Promise<DataPlaneCallResult>;
}

export interface UserActionRequest {
  kind: "login" | "captcha" | "oauth-approve" | "two-factor" | "pairing-code" | "install" | "open-url";
  message: string;
  url?: string;
}

export interface SetupResult {
  ok: boolean;
  status: AdapterStatus;
  message?: string;
  data?: Record<string, unknown>;
}

// ---- Sessions ---------------------------------------------------------------

export interface BrainSession {
  id: string;
  adapterId: string;
  /** Adapter-owned pointer (chat URL, thread id, ...). Opaque to the core. */
  ref: Record<string, unknown>;
}

export interface HarnessSession {
  id: string;
  adapterId: string;
  ref: Record<string, unknown>;
}

export interface BrainCheckpoint {
  adapterId: string;
  ref: Record<string, unknown>;
  savedAt: string;
}

export interface HarnessCheckpoint {
  adapterId: string;
  ref: Record<string, unknown>;
  savedAt: string;
}

export interface SessionContextBase {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  workspaceRoot: string;
  goal: string;
}

export type BrainSessionContext = SessionContextBase;
export type HarnessSessionContext = SessionContextBase;

export interface AwaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Reject messages that do not match (used to filter stale iterations). */
  accept?: (message: ControlMessage) => boolean;
}

export interface VerificationResult {
  verified: boolean;
  method: string;
  message?: string;
  details?: Record<string, unknown>;
}

// ---- Execution --------------------------------------------------------------

/**
 * How much latitude the Harness is given for one dispatch.
 *
 * `standard` is the original behaviour: a goal, a list of steps, and whatever
 * the product chooses to do about them. `execution-only` is Relay Mode's
 * contract — the Brain has already reasoned, and the Harness is expected to
 * execute the named step and stop.
 */
export type ExecutionMode = "execution-only" | "standard";

/** Whether a harness may write documents nobody asked for. */
export type DocumentationPolicy = "if-required" | "never";

export interface ExecutionRequest {
  taskId: string;
  iteration: number;
  /** Natural-language, finite, concrete steps produced by the Brain. */
  instructions: string[];
  goal: string;
  successCriteria?: string;
  filesLikelyInvolved?: string[];
  /** Workspace root the harness must operate in. */
  workspaceRoot: string;
  /**
   * Relay dispatch: the one step the Brain wants executed now, verbatim.
   *
   * Separate from `instructions` so a harness can send a short brief without
   * also sending the whole run's goal and history. When present, it is what
   * the harness should act on.
   */
  nextAction?: string;
  /** How that step will be judged. Shown to the harness, not interpreted by it. */
  acceptance?: string[];
  executionMode?: ExecutionMode;
  /** Suppress unrequested plans, progress reports and summary documents. */
  cleanExecution?: boolean;
  documentation?: DocumentationPolicy;
}

export interface ExecutionHandle {
  id: string;
  adapterId: string;
  ref: Record<string, unknown>;
}

export interface ExecutionResult {
  ok: boolean;
  exitStatus: string;
  changedFiles: number | string[];
  tests?: string | null;
  summary: string;
  commands?: string[];
  durationMs: number;
  /** Optional path to a recorded command output (sanitized on read). */
  outputFile?: string;
}

export type HarnessEvent =
  | { type: "started"; at: string; handleId: string }
  | { type: "log"; at: string; message: string }
  | { type: "progress"; at: string; percent?: number; message?: string }
  | { type: "changed"; at: string; files: string[] }
  | { type: "approval-required"; at: string; message: string }
  | { type: "completed"; at: string; result: ExecutionResult }
  | { type: "failed"; at: string; error: { code: string; message: string } };

// ---- Adapter interfaces -----------------------------------------------------

export interface AdapterCommon {
  metadata(): AdapterMetadata;
  detect(ctx?: DetectContext): Promise<DetectionResult>;
  capabilities(): Promise<CapabilityManifest>;
  setup(ctx: SetupContext): Promise<SetupResult>;
}

export interface BrainAdapter extends AdapterCommon {
  createSession(ctx: BrainSessionContext): Promise<BrainSession>;
  attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession>;
  sendControl(session: BrainSession, message: ControlMessage): Promise<void>;
  awaitControl(session: BrainSession, options?: AwaitOptions): Promise<ControlMessage>;
  verifyWorkspace(session: BrainSession, workspace: { workspaceId: string; root: string }): Promise<VerificationResult>;
  close(session: BrainSession): Promise<void>;
}

export interface HarnessAdapter extends AdapterCommon {
  createSession(ctx: HarnessSessionContext): Promise<HarnessSession>;
  attachSession(checkpoint: HarnessCheckpoint): Promise<HarnessSession>;
  execute(session: HarnessSession, task: ExecutionRequest): Promise<ExecutionHandle>;
  events(handle: ExecutionHandle): AsyncIterable<HarnessEvent>;
  cancel(handle: ExecutionHandle): Promise<void>;
  close(session: HarnessSession): Promise<void>;
  /**
   * Where is this product currently working?
   *
   * Optional, and worth implementing: the whole point of a harness-owned
   * context is that the user should not have to name a folder the Harness
   * already has open. Return `null` when the product does not advertise it —
   * `undefined` and "I could not tell" must be distinguishable from a real
   * answer, and only a real answer is allowed to become a context.
   *
   * `Task.execute`-only harnesses can ignore this entirely.
   */
  getActiveContext?(): Promise<HarnessContextReport | null>;
}

/**
 * What an adapter reports about its active context, before normalisation.
 *
 * Structurally identical to `ReportedContext` in `@agent2llm/pairs`, on
 * purpose: the SDK owns the *contract an adapter satisfies*, the domain
 * package owns normalisation and storage. The duplication is five fields and
 * any drift fails to compile at the call site.
 */
export interface HarnessContextReport {
  /** Absolute path of the project the product has open. */
  root?: string;
  displayName?: string;
  /** 0..1, only when the adapter can genuinely estimate it. */
  confidence?: number;
  detail?: Record<string, string | number | boolean>;
}


export type AnyAdapter = BrainAdapter | HarnessAdapter;

export function isBrainAdapter(adapter: AnyAdapter): adapter is BrainAdapter {
  return adapter.metadata().role === "brain";
}

export function isHarnessAdapter(adapter: AnyAdapter): adapter is HarnessAdapter {
  return adapter.metadata().role === "harness";
}
