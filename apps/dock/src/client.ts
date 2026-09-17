/**
 * The dock's client script — the wiring, not the views.
 *
 * The views live in `view.ts`, the request helper and server shapes in
 * `wire.ts`, the escape hatch in `dom.ts`. What is left here is the behaviour:
 * load the state, draw the creation form, and run a goal while watching the
 * server's own event stream.
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
import { byId, esc } from "./dom.js";
import { api, setToken } from "./wire.js";
import type { ApiError, CatalogView, CreatePairResult, DockState, RunResult } from "./wire.js";
import { formatLive, render, renderCreateForm, renderRunError } from "./view.js";

/** How often the page asks the server what is happening while a run executes. */
const POLL_MS = 1500;

/** How to make a first Pair; the page's bootstrap injects the current spelling. */
let createCommand = "a2l pair create --brain X --harness Y";

async function boot(): Promise<void> {
  try {
    const [state, catalog] = await Promise.all([api<DockState>("/api/state"), api<CatalogView>("/api/catalog")]);
    render(state, createCommand);
    renderCreateForm(catalog);
  } catch (error) {
    byId("pairs").innerHTML =
      '<div class="card error">Could not load state: ' +
      esc((error as Error).message) +
      '<br><br>The token in this URL is required; re-run <code>a2l dock</code> for a fresh one.</div>';
  }
}

/** Makes the pair through the same server path as `a2l pair create`. */
async function createPair(button: HTMLButtonElement): Promise<void> {
  const card = button.closest(".card");
  if (!card) return;
  const brain = (card.querySelector("[data-brain]") as HTMLSelectElement).value;
  const harness = (card.querySelector("[data-harness]") as HTMLSelectElement).value;
  const workspace = (card.querySelector("[data-workspace]") as HTMLInputElement).value.trim();
  const out = card.querySelector<HTMLElement>("[data-create-out]");
  if (!out) return;
  const body: Record<string, string> = { brain, harness };
  if (workspace) body.workspace = workspace;
  button.disabled = true;
  out.textContent = "Creating…";
  try {
    const result = await api<CreatePairResult>("/api/pairs", { method: "POST", body: JSON.stringify(body) });
    out.textContent = (result.created ? "Created " : "Reusing ") + result.pair.pairId + " — " + result.contextNote;
    void boot();
  } catch (error) {
    out.textContent = "Failed: " + (error as Error).message;
  } finally {
    button.disabled = false;
  }
}

/**
 * One goal, end to end, with the live panel updating from /api/state.
 *
 * The POST is blocking by design (one run at a time is the product's
 * concurrency story), so the liveliness comes from polling the state the
 * server is already collecting — there is no second channel to keep honest.
 * The pairs list is *not* re-rendered during the flight: that would wipe the
 * goal box the user is watching.
 */
async function runGoal(card: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const goalInput = card.querySelector("[data-goal]");
  const out = card.querySelector<HTMLElement>("[data-out]");
  const live = card.querySelector<HTMLElement>("[data-live]");
  const pairId = card.dataset.pair;
  if (!goalInput || !out || !pairId) return;
  const goal = (goalInput as HTMLInputElement).value.trim();
  out.hidden = false;
  if (!goal) {
    out.textContent = "Give the Brain a goal first.";
    return;
  }
  const started = Date.now();
  button.disabled = true;
  out.textContent = "Running… this can take minutes; the harness is really working.";

  let polling = true;
  const poll = setInterval(() => {
    if (!polling) return;
    void api<DockState>("/api/state")
      .then((state) => {
        if (!polling || !live) return;
        live.hidden = false;
        live.textContent = formatLive(Math.round((Date.now() - started) / 1000), state);
      })
      .catch(() => {
        // The run request below still stands; a missed poll is not an error
        // the user can act on, so it is not shown as one.
      });
  }, POLL_MS);

  try {
    const result = await api<RunResult>("/api/run", {
      method: "POST",
      body: JSON.stringify({ pairId, goal }),
    });
    let text =
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
    if (result.pendingApprovals && result.pendingApprovals.length > 0) {
      // The dock could not answer these: a page has nobody to prompt. Saying
      // so plainly is the difference between "blocked" and "mysteriously
      // stopped".
      text +=
        "\n\nThe harness asked for a human:" +
        "\n  " +
        result.pendingApprovals.join("\n  ") +
        "\nThis page cannot answer approvals — re-run the goal from a terminal, where the prompt can be answered.";
    }
    out.textContent = text;
  } catch (error) {
    renderRunError(out, pairId, error as ApiError);
  } finally {
    polling = false;
    clearInterval(poll);
    if (live) {
      live.hidden = true;
      live.textContent = "";
    }
    button.disabled = false;
    try {
      render(await api<DockState>("/api/state"), createCommand);
      // The re-render above wiped the goal box; give the user their sentence
      // back, so a follow-up goal is an edit rather than a retyping.
      const again = document.querySelector(`[data-pair="${CSS.escape(pairId)}"] [data-goal]`);
      if (again) (again as HTMLInputElement).value = goal;
    } catch {
      // the result above still stands
    }
  }
}

document.addEventListener("click", async (event) => {
  const createButton = (event.target as Element | null)?.closest("[data-create]");
  if (createButton) {
    await createPair(createButton as HTMLButtonElement);
    return;
  }
  const runButton = (event.target as Element | null)?.closest("[data-run]");
  if (!runButton) return;
  const card = runButton.closest<HTMLElement>("[data-pair]");
  if (!card) return;
  await runGoal(card, runButton as HTMLButtonElement);
});

/** Called once by the page's inline bootstrap with the one-time token. */
export function init(value: string, hints?: { createCommand?: string }): void {
  setToken(value);
  if (hints?.createCommand) createCommand = hints.createCommand;
  void boot();
}
