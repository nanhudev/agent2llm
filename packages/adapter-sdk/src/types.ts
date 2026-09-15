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
}

export type AnyAdapter = BrainAdapter | HarnessAdapter;

export function isBrainAdapter(adapter: AnyAdapter): adapter is BrainAdapter {
  return adapter.metadata().role === "brain";
}

export function isHarnessAdapter(adapter: AnyAdapter): adapter is HarnessAdapter {
  return adapter.metadata().role === "harness";
}
