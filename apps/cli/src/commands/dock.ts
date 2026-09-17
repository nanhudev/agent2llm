/**
 * `a2l dock` — the Desktop Pairing Dock, minimal edition.
 *
 * The dock is a page that lists your pairs and gives each one a goal box. It is
 * a page rather than an Electron window for three reasons, and the first two
 * are the ones that matter:
 *
 * 1. **It cannot disturb a window it does not own.** The directive here was
 *    "never reparent windows", and the strongest way to honour that is to hold
 *    no window handle at all. The dock serves a document; the user's own
 *    browser renders it; nothing calls `SetParent` or moves a frame. An
 *    Electron build would have had to be careful about this; a page cannot get
 *    it wrong.
 * 2. **It adds no dependency.** The package is installed with `npm i -g`, and
 *    an Electron runtime would have multiplied that download to add a list and
 *    a text box.
 * 3. It still runs the real thing: every Run button goes through
 *    `runRelayGoal`, the same function `a2l run` calls.
 *
 * ## What it will not do
 *
 * There is no `--host`. Binding this to anything but loopback would turn a
 * local convenience into a remote execution endpoint for anyone who can reach
 * the port — and the port starts real coding agents. The host is a constant,
 * not a default.
 *
 * ## How it is protected
 *
 * The dock starts real harness processes, so a page in the user's browser
 * asking it to do things is a real attack, not a hypothetical one. Three gates,
 * all of them testable and tested:
 *
 * - **Loopback only.** Bound to `127.0.0.1`, so the socket is not reachable
 *   from the network.
 * - **One-time token.** Generated per start, printed once, compared in constant
 *   time. Required on every route, including the page itself.
 * - **No CORS, and a JSON-only body.** Another origin cannot read a response,
 *   and a cross-origin `POST` with `application/json` requires a preflight this
 *   server never grants. A `text/plain` form post — the classic CSRF shape — is
 *   refused with 415. An explicit `Origin` from somewhere else is refused with
 *   403.
 *
 * Concurrent runs are refused with 409 rather than queued: two harnesses
 * editing one working tree is a corruption, not a queue.
 */
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AdapterRegistry, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { Pair, RunRecord } from "@agent2llm/pairs";
import { CLI_VERSION } from "@agent2llm/config";
import { pairsStore, runsStore } from "./pair-select.js";
import { runRelayGoal } from "./relay-goal.js";
import { renderDockPage } from "@agent2llm/dock";
import * as ui from "../ui.js";

/**
 * The only address the dock binds.
 *
 * Exported because the test asserts it rather than trusting the literal: a
 * future refactor that made this configurable would be a security change, and
 * the test should be the thing that notices.
 */
export const DOCK_HOST = "127.0.0.1";

/** Body ceiling. A goal is a sentence; anything larger is not a goal. */
const MAX_BODY_BYTES = 64 * 1024;
/** How many runs the state payload carries back to the page. */
const RUN_HISTORY = 20;

export interface DockOptions {
  port?: number;
  workspace?: string;
  json?: boolean;
}

export interface DockHandle {
  host: string;
  port: number;
  url: string;
  /** The token, so a test (and only a test) can drive the routes. */
  token: string;
  close(): Promise<void>;
}

interface RunState {
  busy: boolean;
  /** Lines from the orchestration event stream, newest last. */
  events: string[];
  /** Harness approval requests the dock could not answer. */
  pending: string[];
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function html(res: http.ServerResponse, status: number, body: string): void {
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
function tokenMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The recent-run view: enough for a list, and no receipts. */
function runsForPage(runs: RunRecord[]): unknown[] {
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

function pairsForPage(pairs: Pair[]): unknown[] {
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

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is larger than this dock accepts.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Starts the dock. Resolves once it is listening, so the caller can print a
 * URL that already works.
 */
export async function startDock(registry: AdapterRegistry, options: DockOptions = {}): Promise<DockHandle> {
  const token = randomBytes(24).toString("base64url");
  const state: RunState = { busy: false, events: [], pending: [] };
  const requestedPort = Number.isInteger(options.port) ? (options.port as number) : 0;
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error(`--port must be an integer between 0 and 65535, got '${options.port}'.`);
  }

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${DOCK_HOST}`);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;

    if (!tokenMatches(url.searchParams.get("token") ?? req.headers["x-a2l-token"]?.toString() ?? null, token)) {
      json(res, 401, { error: "Missing or wrong token. Use the URL printed by 'a2l dock'." });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      html(res, 200, renderDockPage({ token, version: CLI_VERSION }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, 200, {
        pairs: pairsForPage(pairsStore().list()),
        runs: runsForPage(runsStore().list()),
        busy: state.busy,
        events: state.events.slice(-40),
        pending: state.pending,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      await handleRun(req, res, port);
      return;
    }

    json(res, 404, { error: `No route for ${req.method} ${url.pathname}.` });
  }

  async function handleRun(req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<void> {
    // A browser sends Origin on cross-origin POSTs. Same-origin requests from
    // our own page send it too, so it is compared rather than required.
    const origin = req.headers.origin;
    if (origin && origin !== `http://${DOCK_HOST}:${port}` && origin !== `http://localhost:${port}`) {
      json(res, 403, { error: "Cross-origin requests are refused." });
      return;
    }
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "application/json") {
      json(res, 415, { error: "A run must be posted as application/json." });
      return;
    }
    if (state.busy) {
      json(res, 409, { error: "A run is already in progress. Two harnesses in one working tree is a corruption." });
      return;
    }

    let body: { pairId?: unknown; goal?: unknown };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch (error) {
      json(res, 400, { error: `Could not read the request: ${(error as Error).message}` });
      return;
    }
    const pairId = typeof body.pairId === "string" ? body.pairId : "";
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    if (pairId === "" || goal === "") {
      json(res, 400, { error: "Both pairId and goal are required." });
      return;
    }
    if (!pairsStore().get(pairId)) {
      json(res, 404, { error: `No pair '${pairId}'.` });
      return;
    }

    state.busy = true;
    state.events = [];
    state.pending = [];
    try {
      const outcome = await runRelayGoal(registry, {
        pair: pairId,
        goal,
        ...(options.workspace ? { workspace: options.workspace } : {}),
      }, {
        onEvent: (line) => state.events.push(line),
        // The dock has nobody to prompt: a request that blocks here would hang
        // the page with no way to answer it. It is recorded and reported
        // instead, so the user is told to run that step in a terminal.
        requestUserAction: async (action: UserActionRequest) => {
          state.pending.push(`${action.kind}: ${action.message}`);
        },
      });
      if (!outcome.ok) {
        json(res, 400, { error: outcome.error });
        return;
      }
      json(res, 200, {
        ...outcome.result,
        context: outcome.context?.root ?? null,
        notes: outcome.notes,
        ...(state.pending.length > 0
          ? { pendingApprovals: [...state.pending] }
          : {}),
      });
    } catch (error) {
      json(res, 500, { error: (error as Error).message });
    } finally {
      state.busy = false;
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, DOCK_HOST, resolve);
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("The dock started but reported no address.");
  }

  return {
    host: DOCK_HOST,
    port: address.port,
    token,
    url: `http://${DOCK_HOST}:${address.port}/?token=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/** `a2l dock`: start it, print where it is, and stay until interrupted. */
export async function runDock(registry: AdapterRegistry, options: DockOptions): Promise<number> {
  let dock: DockHandle;
  try {
    dock = await startDock(registry, options);
  } catch (error) {
    ui.fail(`Could not start the dock: ${(error as Error).message}`);
    return 1;
  }

  const pairs = pairsStore().list();
  if (options.json) {
    ui.jsonOutput({
      url: dock.url,
      host: dock.host,
      port: dock.port,
      token: dock.token,
      pairs: pairsForPage(pairs),
    });
  } else {
    ui.heading("Agent2LLM Dock");
    ui.line(ui.dim(`  listening on ${dock.host}:${dock.port} (loopback only, no other host is possible)`));
    ui.line(ui.dim(`  pairs: ${pairs.length}`));
    ui.line();
    ui.line(`  Open this URL — the token in it is the only way in:`);
    ui.line(`  ${ui.cyan(dock.url)}`);
    ui.line();
    ui.line(ui.dim("  This page starts real Relay runs. It holds no handle to any window,"));
    ui.line(ui.dim("  so it cannot move or resize the harness you have open. Ctrl-C stops it."));
  }

  // The token is deliberately not printed anywhere else — not in a log, not in
  // a second message — because the URL above is the whole secret.
  return new Promise<number>((resolve) => {
    const stop = (): void => {
      void dock.close().then(() => {
        ui.line();
        ui.line("Dock stopped.");
        resolve(0);
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
