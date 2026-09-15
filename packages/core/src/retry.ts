import { A2LError, isA2LError } from "./errors.js";

/**
 * Retry policy.
 *
 * Only transient infrastructure failures are retried. Authentication,
 * CAPTCHA and 2FA failures are never retried — brute-forcing a login is a
 * security defect, not a resilience feature.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; error: A2LError; delayMs: number }) => void;
}

const TRANSIENT_HINTS = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /fetch failed/i,
  /temporarily unavailable/i,
];

export function isTransientError(error: unknown): boolean {
  if (isA2LError(error)) {
    if (!error.retryable) return false;
    return ["Timeout", "TransportFailure", "TunnelFailure", "BrowserFailure", "ExecutionFailed"].includes(
      error.code
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_HINTS.some((pattern) => pattern.test(message));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new A2LError("Retry aborted", { code: "Timeout" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  let lastError: A2LError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const normalized = isA2LError(error)
        ? error
        : new A2LError(error instanceof Error ? error.message : String(error), { cause: error });
      lastError = normalized;
      if (attempt >= maxAttempts || !isTransientError(normalized)) throw normalized;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = options.jitter === false ? 0 : Math.random() * baseDelayMs;
      const delayMs = Math.round(exponential + jitter);
      options.onRetry?.({ attempt, error: normalized, delayMs });
      await delay(delayMs, options.signal);
    }
  }
  throw lastError ?? new A2LError("Retry loop exhausted", { code: "InternalError" });
}
