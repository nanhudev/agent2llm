/**
 * HTTP plumbing and the page-shape views for the dock.
 *
 * Split out of `dock.ts` so the route handlers there stay about *what* the
 * dock does rather than how responses are serialised. Everything in this file
 * can be answered without reading the routes:
 *
 * - `json`/`html` write a response with the security headers every route wants;
 * - `gatePost` is the check every state-changing POST must pass before its
 *   body is read — a cross-origin request is refused, and a form-encoded body
 *   (the classic CSRF shape) is refused;
 * - `pairsForPage`/`runsForPage` are whitelists. A new field on a record
 *   reaches the page only by being added here on purpose, never by a spread —
 *   receipts contain harness text and must not reach a browser by accident.
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Pair, RunRecord } from "@agent2llm/pairs";

/**
 * The only address the dock binds.
 *
 * Not a default — a constant. Re-exported by `dock.ts` because that is where
 * the command's surface lives; the value is decided here next to the code
 * that binds it.
 */
export const DOCK_HOST = "127.0.0.1";

/** Body ceiling. A goal is a sentence; anything larger is not a goal. */
export const MAX_BODY_BYTES = 64 * 1024;
/** How many runs the state payload carries back to the page. */
const RUN_HISTORY = 20;

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

export function html(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    // A page that can start processes should not be frameable by another site.
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

/** Constant-time token check; a length mismatch cannot leak through `timingSafeEqual`. */
export function tokenMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The two checks every state-changing POST passes before its body is read.
 *
 * A browser sends `Origin` on cross-origin POSTs. Same-origin requests from
 * our own page send it too, so it is compared rather than required. The
 * content-type check refuses the `text/plain` form post a cross-site form
 * takes, without needing a cookie to protect — the dock sets none.
 */
export function gatePost(req: http.IncomingMessage, res: http.ServerResponse, port: number, noun: string): boolean {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${DOCK_HOST}:${port}` && origin !== `http://localhost:${port}`) {
    json(res, 403, { error: "Cross-origin requests are refused." });
    return false;
  }
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    json(res, 415, { error: `A ${noun} must be posted as application/json.` });
    return false;
  }
  return true;
}

export async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is larger than this dock accepts.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The recent-run view: enough for a list, and no receipts. */
export function runsForPage(runs: RunRecord[]): unknown[] {
  return [...runs]
    .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1))
    .slice(0, RUN_HISTORY)
    .map((run) => ({
      runId: run.runId,
      pairId: run.pairId,
      goal: run.goal,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      iterations: run.iterations,
    }));
}

export function pairsForPage(pairs: Pair[]): unknown[] {
  return pairs.map((pair) => ({
    pairId: pair.pairId,
    label: pair.label,
    brainAdapterId: pair.brainAdapterId,
    harnessAdapterId: pair.harnessAdapterId,
    context: pair.context ? { root: pair.context.root, source: pair.context.source } : null,
    contextMode: pair.contextMode,
    executionPolicy: { mode: pair.executionPolicy.mode },
    lastRunAt: pair.lastRunAt,
  }));
}
