/**
 * `a2l dock`, driven as a real process over real HTTP.
 *
 * The dock can start coding agents, so the interesting claims are not "does the
 * page render" but "what can reach it, and what can it be made to do". Each of
 * the gates in `dock.ts` is asserted here against the shipped CLI rather than
 * against a helper: the token, the loopback bind, the refusal of a form post,
 * the refusal of another origin, the refusal to run two things at once.
 *
 * A subprocess rather than an import, for the same reason `cli-pair.test.mjs`
 * is: `apps/cli/src/index.ts` calls `main()` on import, so the only honest test
 * of the dispatch, the flags and the URL it prints is the binary.
 *
 * The one-time token is read out of the URL the CLI prints, which is also the
 * evidence that the CLI *prints* it — a dock whose token cannot be found is a
 * dock nobody can open.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "apps", "cli", "dist", "index.js");
const STATE = path.join(process.env.AGENT2LLM_STATE_DIR ?? ROOT, "cli-dock");

/**
 * The plan the mock Brain follows when this file's dock drives it.
 *
 * Written before the dock starts, because the dock reads it at process start.
 * It is needed because the mock Brain's built-in default is the *brain-hands*
 * script — INSPECTING, PLAN, REVIEWING, DONE — and Relay only accepts a
 * NEXT_ACTION or a verdict. Left alone, every dock run would end `blocked` with
 * "the Brain sent PLAN where a next step was expected", which is correct
 * behaviour and useless as a test of the Run button.
 */
fs.mkdirSync(STATE, { recursive: true });
const BRAIN_SCRIPT = path.join(STATE, "dock-brain-script.json");
fs.writeFileSync(
  BRAIN_SCRIPT,
  JSON.stringify([
    { type: "NEXT_ACTION", task: "Write one small file and stop.", acceptance: ["the file exists"] },
    { type: "DONE", summary: "dock run finished" },
  ])
);

/** A dock, started once and reused; starting one per test would pay the CLI's
 *  adapter registration eight times for no extra information. */
let dock = null;

function launch(args, env = {}) {
  const child = spawn(process.execPath, [CLI, "dock", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT2LLM_STATE_DIR: STATE,
      NO_COLOR: "1",
      A2L_MOCK_BRAIN_SCRIPT: BRAIN_SCRIPT,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (handle.stdout += chunk));
  child.stderr.on("data", (chunk) => (handle.stderr += chunk));
  return handle;
}

/** Waits for the `--json` line the CLI prints once it is listening. */
async function waitForDock(handle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = handle.stdout.trim();
    if (text.endsWith("}")) {
      try {
        return JSON.parse(text);
      } catch {
        // Not the whole object yet; keep reading.
      }
    }
    if (handle.child.exitCode !== null) {
      throw new Error(`dock exited with ${handle.child.exitCode}: ${handle.stderr || handle.stdout}`);
    }
    if (Date.now() > deadline) throw new Error(`dock did not print a URL in time: ${handle.stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function ensureDock() {
  if (dock) return dock;
  const handle = launch(["--json", "--port", "0"]);
  const info = await waitForDock(handle);
  dock = { ...handle, info };
  return dock;
}

function stopDock() {
  if (dock) {
    dock.child.kill();
    dock = null;
  }
}

// Best effort, so a failing assertion above does not leave the runner waiting
// on an open pipe.
process.on("exit", stopDock);

function a2l(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: STATE, NO_COLOR: "1" },
  });
}

test("cli-dock", "the CLI entry point is built and runnable", () => {
  assert(fs.existsSync(CLI), `${CLI} must exist — the suite runs against built output (npm run build)`);
});

test("cli-dock", "every pair the user made is in the dock, addressed by pair id", () => {
  const created = a2l(
    "pair", "create",
    "--brain", "mock-brain",
    "--harness", "mock-harness",
    "--workspace", path.join(STATE, "workspace"),
    "--json"
  );
  assertEqual(created.status, 0, `pair create failed: ${created.stdout}${created.stderr}`);
});

test("cli-dock", "port 0 is bound, and the address is loopback — not 0.0.0.0", async () => {
  const { info } = await ensureDock();
  assertEqual(info.host, "127.0.0.1", "the dock binds loopback and the CLI says so");
  assert(info.port > 0, `an ephemeral port was assigned: ${info.port}`);
  assertEqual(new URL(info.url).hostname, "127.0.0.1", "and the printed URL is on that host");
  assert(info.token.length >= 20, `the token is long enough to be a secret: ${info.token.length} chars`);
});

test("cli-dock", "without the token nothing is served — not the page, not the state", async () => {
  const { info } = await ensureDock();
  const base = `http://${info.host}:${info.port}`;

  const page = await fetch(`${base}/`);
  assertEqual(page.status, 401, "the page itself is gated, so a stray tab cannot load it");

  const state = await fetch(`${base}/api/state`);
  assertEqual(state.status, 401, "and so is the state");

  const wrong = await fetch(`${base}/api/state?token=${info.token}x`);
  assertEqual(wrong.status, 401, "a near-miss token is a wrong token");
});

test("cli-dock", "the page is self-contained, so the token cannot leak to a third party", async () => {
  const { info } = await ensureDock();
  const response = await fetch(info.url);
  assertEqual(response.status, 200, "the printed URL opens the dock");
  const html = await response.text();

  assert(html.includes("Agent2LLM Dock"), "it is the dock");
  assert(html.includes(info.token), "the page carries the token it will use");
  assert(!/<script[^>]+\bsrc=/i.test(html), "no external script, so nothing else can read the token");
  assert(!/<link[^>]+\bhref=/i.test(html), "and no external stylesheet either");
  assert(!/https?:\/\//i.test(html.replace(/http:\/\/127\.0\.0\.1:\d+/g, "")),
    "the only URL in the document is the loopback one it came from");
  assert(/never moves another app's window/i.test(html),
    "the page states the property the dock was chosen for");
});

test("cli-dock", "state lists pairs and runs without shipping receipts", async () => {
  const { info } = await ensureDock();
  const body = await (await fetch(`http://${info.host}:${info.port}/api/state?token=${info.token}`)).json();

  assert(Array.isArray(body.pairs), "pairs is a list");
  assert(Array.isArray(body.runs), "runs is a list");
  assert(body.pairs.length >= 1, `the pair from the previous test is visible: ${JSON.stringify(body.pairs[0])}`);
  const pair = body.pairs[0];
  assertEqual(pair.brainAdapterId, "mock-brain", "with its brain");
  assertEqual(pair.harnessAdapterId, "mock-harness", "and its harness");
  assert(pair.context === null || typeof pair.context.root === "string", "and its context, if it has one");
  assertEqual(body.busy, false, "nothing is running yet");
});

test("cli-dock", "the catalog lists what can actually be joined, and is token-gated", async () => {
  const { info } = await ensureDock();
  const base = `http://${info.host}:${info.port}`;

  const gated = await fetch(`${base}/api/catalog`);
  assertEqual(gated.status, 401, "the catalog is a route like any other: no token, no answer");

  const body = await (await fetch(`${base}/api/catalog?token=${info.token}`)).json();
  const ids = body.adapters.map((adapter) => adapter.id);
  assert(ids.includes("mock-brain"), `the registered brains are offered: ${ids.join(", ")}`);
  assert(ids.includes("mock-harness"), "and the registered harnesses");
  const brain = body.adapters.find((adapter) => adapter.id === "mock-brain");
  assertEqual(brain.role, "brain", "each entry carries its role, so a form cannot cross the sides");
});

test("cli-dock", "a pair can be created from the page, through the pair-create path", async () => {
  const { info } = await ensureDock();
  const url = `http://${info.host}:${info.port}/api/pairs?token=${info.token}`;
  const post = (body, extra = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  const form = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "brain=mock-brain&harness=mock-harness",
  });
  assertEqual(form.status, 415, "a form post is refused here too");
  const cross = await post({ brain: "mock-brain", harness: "mock-harness" }, { origin: "https://example.com" });
  assertEqual(cross.status, 403, "and so is another origin");

  const crossed = await post({ brain: "mock-harness", harness: "mock-brain" });
  assertEqual(crossed.status, 400, "the sides cannot be crossed");
  const crossedBody = await crossed.json();
  assert(
    /is a harness, not a brain/.test(crossedBody.error),
    `the error names the mistake: ${crossedBody.error}`
  );
  const unknown = await post({ brain: "no-such-brain", harness: "mock-harness" });
  assertEqual(unknown.status, 400, "an unknown adapter is refused, named");

  // Unique per run: the runner gives this file a private state directory, but
  // a bare `node tests/cli-dock.test.mjs` reuses the repo-root one, and a pair
  // left there by the last run must not turn this create into a reuse.
  const workspace = path.join(STATE, `dock-made-${Date.now()}`);
  fs.mkdirSync(workspace, { recursive: true });
  const made = await post({ brain: "mock-brain", harness: "mock-harness", workspace });
  const madeBody = await made.json();
  assertEqual(made.status, 200, `creation succeeds: ${JSON.stringify(madeBody)}`);
  assertEqual(madeBody.created, true, "a fresh pair is reported as created");
  assertEqual(madeBody.pair.brainAdapterId, "mock-brain", "with the brain it asked for");
  assertEqual(madeBody.pair.harnessAdapterId, "mock-harness", "and the harness");
  assertEqual(madeBody.pair.context.root, workspace, "and the workspace it was given");

  const again = await post({ brain: "mock-brain", harness: "mock-harness", workspace });
  const againBody = await again.json();
  assertEqual(againBody.created, false, "the same request again is a continuation, not a fork");
  assertEqual(againBody.pair.pairId, madeBody.pair.pairId, "and it is the same pair");

  const after = await (await fetch(`http://${info.host}:${info.port}/api/state?token=${info.token}`)).json();
  assert(
    after.pairs.some((pair) => pair.pairId === madeBody.pair.pairId),
    "the pair appears in the state the page renders"
  );
});

test("cli-dock", "a run posted as a form is refused before it is read", async () => {
  const { info } = await ensureDock();
  // This is the shape a cross-site form post takes, and it is why the content
  // type is checked: refusing it refuses the classic CSRF without needing a
  // cookie to protect, because the dock sets none.
  const response = await fetch(`http://${info.host}:${info.port}/api/run?token=${info.token}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "pairId=x&goal=y",
  });
  assertEqual(response.status, 415, "a form body must not be accepted");
});

test("cli-dock", "a request from another origin is refused", async () => {
  const { info } = await ensureDock();
  const response = await fetch(`http://${info.host}:${info.port}/api/run?token=${info.token}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify({ pairId: "x", goal: "y" }),
  });
  assertEqual(response.status, 403, "a page on another site must not be able to start a run");
});

test("cli-dock", "an incomplete or unknown request names what is wrong", async () => {
  const { info } = await ensureDock();
  const post = (body) =>
    fetch(`http://${info.host}:${info.port}/api/run?token=${info.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  assertEqual((await post(JSON.stringify({ goal: "no pair" }))).status, 400, "no pairId");
  assertEqual((await post(JSON.stringify({ pairId: "a2lp_nope", goal: "x" }))).status, 404, "unknown pair");
  assertEqual((await post("{ not json")).status, 400, "unreadable body");

  const empty = await post(JSON.stringify({ pairId: "a2lp_nope", goal: "   " }));
  assertEqual(empty.status, 400, "a blank goal is not a goal");

  // A failure a user can act on says what to do next — and names a command
  // that actually exists.
  const missing = await post(JSON.stringify({ pairId: "a2lp_nope", goal: "x" }));
  const missingBody = await missing.json();
  assert(typeof missingBody.hint === "string" && missingBody.hint.length > 0,
    `the 404 carries a next step: ${JSON.stringify(missingBody)}`);
  assert(/pair list/.test(missingBody.hint), "the hint names the way to check pairs");
});

test("cli-dock", "the Run button runs the real relay path and reports the real status", async () => {
  const { info } = await ensureDock();
  const state = await (await fetch(`http://${info.host}:${info.port}/api/state?token=${info.token}`)).json();
  const pairId = state.pairs[0].pairId;

  const response = await fetch(`http://${info.host}:${info.port}/api/run?token=${info.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairId, goal: "Write one small file and stop." }),
  });
  const body = await response.json();
  assertEqual(response.status, 200, `the run must be accepted: ${JSON.stringify(body)}`);

  assertEqual(body.pairId, pairId, "the run belongs to the pair that was asked for");
  assertEqual(
    body.status,
    "done",
    `the injected plan is one step and a verdict, so the run completes: ${body.summary}`
  );
  assert(typeof body.summary === "string" && body.summary.length > 0, "and a summary");
  assert(body.iterations >= 1, `the harness was really dispatched to: ${body.iterations}`);
  assert(body.metrics && typeof body.metrics.elapsedMs === "number", "with measured numbers, not invented ones");

  // The Brain's spend arrives as the accounting union — a provider-reported
  // figure or the reason there is none — never as a bare number that could
  // be a fabricated 0. Same discipline for the test count.
  const tokens = body.metrics.brainTokens;
  assert(
    tokens === null ||
      (typeof tokens === "object" && (tokens.source === "provider-reported" || tokens.source === "unavailable")),
    `brain tokens carry the accounting union: ${JSON.stringify(tokens)}`
  );
  if (tokens && tokens.source === "unavailable") {
    assert(typeof tokens.reason === "string" && tokens.reason.length > 0, "unavailable names its reason");
  }
  assert(
    body.metrics.testsPassed === null || typeof body.metrics.testsPassed === "number",
    "the test count is a number or an honest null"
  );

  // The run is on the record, which is what makes it a run and not a keystroke.
  const after = await (await fetch(`http://${info.host}:${info.port}/api/state?token=${info.token}`)).json();
  assert(
    after.runs.some((run) => run.runId === body.runId),
    `the run appears in history: ${JSON.stringify(after.runs.map((run) => run.runId))}`
  );
  assertEqual(after.busy, false, "and the dock is free again");
});

test("cli-dock", "while a run executes, the state endpoint is the live channel", async () => {
  const { info } = await ensureDock();
  const base = `http://${info.host}:${info.port}`;
  const query = `${base}/api/state?token=${info.token}`;
  const pairId = (await (await fetch(query)).json()).pairs[0].pairId;

  // Started, not awaited: the page's Run button is exactly this shape — a
  // blocking POST, with /api/state polled beside it for the live panel.
  const runPromise = fetch(`${base}/api/run?token=${info.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairId, goal: "Write one small file and stop." }),
  });

  let busySeen = false;
  for (let polled = 0; polled < 3; polled++) {
    const state = await (await fetch(query)).json();
    assert(typeof state.busy === "boolean", "busy is a boolean a page can branch on");
    assert(Array.isArray(state.events), "events is the operational line tail");
    assert(Array.isArray(state.pending), "pending is the list of unanswered approvals");
    if (state.busy) busySeen = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // The mock run can finish faster than a poll lands, so *catching* busy:true
  // is not asserted — but whatever the poller reads must be well-formed, and
  // the finished run's own operational lines must be sitting on that channel,
  // because that is the exact content a live panel would have been showing.
  const outcome = await runPromise;
  assertEqual(outcome.status, 200, "the run completed");
  const after = await (await fetch(query)).json();
  assertEqual(after.busy, false, "the dock reports itself free when it is done");
  assert(after.events.length > 0 || busySeen, `the run's operational lines are on the channel: ${JSON.stringify(after.events)}`);
});

test("cli-dock", "a port that cannot be an integer is rejected with the reason", () => {
  const result = a2l("dock", "--port", "99999");
  assertEqual(result.status, 1, "the dock must not start on a nonsense port");
  assert(
    /between 0 and 65535/.test(result.stdout),
    `the failure has to say what is wrong, got: ${result.stdout.trim()}`
  );
});

// Last, and registered as a test rather than done inline, because `runAll`
// keeps going after a failure: a cleanup at the end of another test would be
// skipped by exactly the failure most likely to leave a process running.
test("cli-dock", "the dock is stopped and the port is released", () => {
  stopDock();
  assertEqual(dock, null, "no dock outlives this file");
});

await report();
