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

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  const record = (body ?? {}) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(record.error ?? `HTTP ${response.status}`));
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

export interface RunResult {
  status: string;
  summary: string;
  iterations: number;
  metrics: { filesChanged: number; elapsedMs: number };
  conversation: { reused: boolean };
}
