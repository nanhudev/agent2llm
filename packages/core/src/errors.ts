/**
 * Typed error taxonomy. Nothing in the core path is allowed to throw
 * `new Error("something went wrong")`: every failure is classified so the
 * CLI, doctor and orchestrator can react without string matching.
 */
export const A2L_ERROR_CODES = [
  "AdapterNotFound",
  "AdapterUnavailable",
  "AdapterIncompatible",
  "AuthenticationRequired",
  "BrainUnavailable",
  "HarnessUnavailable",
  "WorkspaceViolation",
  "ProtocolViolation",
  "SessionLost",
  "ExecutionFailed",
  "Timeout",
  "TransportFailure",
  "TunnelFailure",
  "BrowserFailure",
  "UserActionRequired",
  "InternalError",
] as const;

export type A2LErrorCode = (typeof A2L_ERROR_CODES)[number];

/** Failure classes that a retry policy must never touch. */
export const NON_RETRYABLE_CODES: readonly A2LErrorCode[] = [
  "AuthenticationRequired",
  "UserActionRequired",
  "AdapterIncompatible",
  "WorkspaceViolation",
  "ProtocolViolation",
];

export interface A2LErrorOptions {
  code?: A2LErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
  /** Single next action for the user, when one exists. */
  hint?: string;
  retryable?: boolean;
}

export class A2LError extends Error {
  readonly code: A2LErrorCode;
  readonly details: Record<string, unknown>;
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(message: string, options: A2LErrorOptions = {}) {
    super(message);
    this.name = "A2LError";
    this.code = options.code ?? "InternalError";
    this.details = options.details ?? {};
    if (options.hint !== undefined) this.hint = options.hint;
    this.retryable = options.retryable ?? !NON_RETRYABLE_CODES.includes(this.code);
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export function isA2LError(value: unknown): value is A2LError {
  return value instanceof A2LError;
}

export function toA2LError(value: unknown, fallbackCode: A2LErrorCode = "InternalError"): A2LError {
  if (isA2LError(value)) return value;
  return new A2LError(value instanceof Error ? value.message : String(value), {
    code: fallbackCode,
    cause: value,
  });
}

const factory = (code: A2LErrorCode) =>
  (message: string, options: Omit<A2LErrorOptions, "code"> = {}): A2LError =>
    new A2LError(message, { ...options, code });

export const adapterNotFound = factory("AdapterNotFound");
export const adapterUnavailable = factory("AdapterUnavailable");
export const adapterIncompatible = factory("AdapterIncompatible");
export const authenticationRequired = factory("AuthenticationRequired");
export const brainUnavailable = factory("BrainUnavailable");
export const harnessUnavailable = factory("HarnessUnavailable");
export const workspaceViolation = factory("WorkspaceViolation");
export const protocolViolation = factory("ProtocolViolation");
export const sessionLost = factory("SessionLost");
export const executionFailed = factory("ExecutionFailed");
export const timeoutError = factory("Timeout");
export const transportFailure = factory("TransportFailure");
export const tunnelFailure = factory("TunnelFailure");
export const browserFailure = factory("BrowserFailure");
export const userActionRequired = factory("UserActionRequired");
export const internalError = factory("InternalError");

/** The single-action prompt shown to the user by the CLI. */
export interface UserAction {
  kind: "login" | "captcha" | "oauth-approve" | "two-factor" | "pairing-code" | "install" | "open-url";
  message: string;
  url?: string;
}

export function requiresUserAction(action: UserAction): A2LError {
  return userActionRequired(action.message, {
    details: { action },
    retryable: false,
  });
}
