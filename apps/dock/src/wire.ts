/**
 * The dock client's HTTP access and the shapes it consumes.
 *
 * One request helper so the token's handling is written once: it goes out in
 * the query string of a same-origin fetch, to the loopback server that served
 * this very document. There is no other destination in this file — a page
 * with no external requests cannot leak the token to a third party by
 * accident.
 */

let token = "";

export function setToken(value: string): void {
  token = value;
}

/**
 * A failed request, carrying what the server said about it.
 *
 * `hint` is the server's next step for errors a user can act on; absent for
 * the rest, because the page will not invent advice it cannot back up.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly hint?: string;

  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  const record = (body ?? {}) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(record.error ?? `HTTP ${response.status}`),
      typeof record.hint === "string" ? record.hint : undefined
    );
  }
  return body as T;
}

export interface PairView {
  pairId: string;
  label?: string;
  brainAdapterId: string;
  harnessAdapterId: string;
  context?: { root: string } | null;
  executionPolicy: { mode: string };
  lastRunAt?: string | null;
}

export interface RunView {
  runId: string;
  status: string;
  iterations: number;
  goal: string;
}

export interface DockState {
  pairs: PairView[];
  runs: RunView[];
  busy?: boolean;
  events?: string[];
  pending?: string[];
}

export interface CatalogAdapter {
  id: string;
  name: string;
  role: string;
  experimental: boolean;
}

export interface CatalogView {
  adapters: CatalogAdapter[];
}

export interface CreatePairResult {
  pair: PairView;
  created: boolean;
  contextNote: string;
}

/**
 * The Brain's (or Harness's) spend, exactly as the product accounts for it:
 * a provider-reported pair of numbers, or the reason there is no number.
 * `null` means nothing was measured at all. None of these shapes may be
 * rendered as a fabricated 0.
 */
export type UsageAccountingView =
  | { source: "provider-reported"; promptTokens: number; completionTokens: number; model?: string }
  | { source: "unavailable"; reason: string };

/** Measured text sizes. `estimatedTextTokens` is a bytes/4 estimate, never a provider's count. */
export interface TextSizeView {
  bytes: number;
  estimatedTextTokens: number;
}

export interface RunMetricsView {
  brainTurns: number;
  harnessRuns: number;
  filesChanged: number;
  /** `null` means no test command reported a number — not zero. */
  testsPassed: number | null;
  revisions: number;
  brainTokens: UsageAccountingView | null;
  harnessUsage: UsageAccountingView | null;
  harnessInstruction: TextSizeView;
  harnessResponse: TextSizeView;
  evidenceRaw: TextSizeView;
  evidenceCompact: TextSizeView;
  brainPrompt: TextSizeView;
  brainResponse: TextSizeView;
  elapsedMs: number;
}

export interface RunResult {
  runId: string;
  status: string;
  summary: string;
  iterations: number;
  metrics: RunMetricsView;
  conversation: { reused: boolean };
  pendingApprovals?: string[];
}
