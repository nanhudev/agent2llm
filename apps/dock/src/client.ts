/**
 * The dock's client script.
 *
 * One self-contained document: no framework, no network access to anything
 * but the loopback server that served it. That is not minimalism for its own
 * sake — a page that can start real executions has to be auditable in one
 * reading, and a page with no external requests cannot leak the token to a
 * third party by accident.
 *
 * The token arrives at `init()` from an inline bootstrap in the page rather
 * than in a cookie, because the server sets no cookies at all: a credential
 * that only exists in a document the user opened themselves is not reachable
 * by another origin.
 *
 * Built by `apps/dock/build.mjs` into `src/assets.gen.ts`, which the server
 * inlines into the page it serves. This file is the readable source; the
 * generated artifact must not be edited by hand.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page is missing #${id}`);
  return element;
}

let token = "";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  const record = (body ?? {}) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(record.error ?? `HTTP ${response.status}`));
  return body as T;
}

interface PairView {
  pairId: string;
  label?: string;
  brainAdapterId: string;
  harnessAdapterId: string;
  context?: { root: string } | null;
  executionPolicy: { mode: string };
  lastRunAt?: string | null;
}

interface RunView {
  runId: string;
  status: string;
  iterations: number;
  goal: string;
}

interface DockState {
  pairs: PairView[];
  runs: RunView[];
}

interface RunResult {
  status: string;
  summary: string;
  iterations: number;
  metrics: { filesChanged: number; elapsedMs: number };
  conversation: { reused: boolean };
}

function pairCard(pair: PairView): string {
  const context = pair.context ? pair.context.root : "(no context yet)";
  return `<div class="card" data-pair="${esc(pair.pairId)}">
    <h2>${esc(pair.label ?? pair.pairId)}</h2>
    <div class="meta">${esc(pair.brainAdapterId)} &times; ${esc(pair.harnessAdapterId)}
      &middot; <code>${esc(context)}</code>
      &middot; ${esc(pair.executionPolicy.mode)}
      &middot; last run: ${esc(pair.lastRunAt ? pair.lastRunAt.replace("T", " ").slice(0, 19) : "never")}
    </div>
    <div class="row">
      <input type="text" placeholder="Goal for this pair" data-goal>
      <button data-run>Run</button>
    </div>
    <pre hidden data-out></pre>
  </div>`;
}

function render(state: DockState): void {
  const host = byId("pairs");
  host.innerHTML = state.pairs.length
    ? state.pairs.map(pairCard).join("")
    : '<div class="card empty">No pairs yet. Create one with <code>a2l pair create --brain X --harness Y</code>.</div>';

  const runs = byId("runs");
  runs.className = state.runs.length ? "" : "empty";
  runs.innerHTML = state.runs.length
    ? '<div class="meta">' +
      state.runs
        .map(
          (run) =>
            `<div><span class="${esc(run.status)}">${esc(run.status)}</span> ` +
            `<code>${esc(run.runId)}</code> &middot; ${esc(run.iterations)} execution(s) &middot; ` +
            esc(run.goal.slice(0, 90)) +
            "</div>"
        )
        .join("") +
      "</div>"
    : "No runs yet.";
}

async function boot(): Promise<void> {
  try {
    render(await api<DockState>("/api/state"));
  } catch (error) {
    byId("pairs").innerHTML =
      '<div class="card error">Could not load state: ' +
      esc((error as Error).message) +
      '<br><br>The token in this URL is required; re-run <code>a2l dock</code> for a fresh one.</div>';
  }
}

document.addEventListener("click", async (event) => {
  const button = (event.target as Element | null)?.closest("[data-run]");
  if (!button) return;
  const card = button.closest("[data-pair]");
  if (!card) return;
  const goalInput = card.querySelector("[data-goal]");
  const out = card.querySelector<HTMLElement>("[data-out]");
  if (!goalInput || !out) return;
  const goal = (goalInput as HTMLInputElement).value.trim();
  out.hidden = false;
  if (!goal) {
    out.textContent = "Give the Brain a goal first.";
    return;
  }
  const buttonEl = button as HTMLButtonElement;
  buttonEl.disabled = true;
  out.textContent = "Running… this can take minutes; the harness is really working.";
  try {
    const result = await api<RunResult>("/api/run", {
      method: "POST",
      body: JSON.stringify({ pairId: (card as HTMLElement).dataset.pair, goal }),
    });
    out.textContent =
      result.status.toUpperCase() +
      " — " +
      result.summary +
      "\n\n" +
      result.iterations +
      " execution(s) · " +
      result.metrics.filesChanged +
      " file(s) changed · " +
      (result.metrics.elapsedMs / 1000).toFixed(1) +
      "s" +
      (result.conversation.reused ? " · continued the same Brain conversation" : " · new Brain thread");
  } catch (error) {
    out.textContent = "Failed: " + (error as Error).message;
  } finally {
    buttonEl.disabled = false;
    try {
      render(await api<DockState>("/api/state"));
    } catch {
      // the result above still stands
    }
  }
});

/** Called once by the page's inline bootstrap with the one-time token. */
export function init(value: string): void {
  token = value;
  void boot();
}
