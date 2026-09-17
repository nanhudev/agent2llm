/**
 * What the dock's page looks like, as functions from data to HTML.
 *
 * Every view here takes already-typed server shapes and returns strings; the
 * dynamic values go through `esc`, and the parts that must not be escaped
 * (the page's own buttons and structure) are literals in these templates.
 * A reader can audit what reaches the page by reading this file alone.
 */
import { esc } from "./dom.js";
import type { CatalogAdapter, CatalogView, DockState, PairView } from "./wire.js";

export function pairCard(pair: PairView): string {
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
    <pre data-live hidden></pre>
    <pre hidden data-out></pre>
  </div>`;
}

export function render(state: DockState, emptyHint: string): void {
  const host = document.getElementById("pairs");
  if (!host) throw new Error("the page is missing #pairs");
  host.innerHTML = state.pairs.length
    ? state.pairs.map(pairCard).join("")
    : `<div class="card empty">No pairs yet. Create one below, or with <code>${esc(emptyHint)}</code>.</div>`;

  const runs = document.getElementById("runs");
  if (!runs) throw new Error("the page is missing #runs");
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

/** The creation form: two selects drawn from the real registry, nothing invented. */
export function renderCreateForm(catalog: CatalogView): void {
  const host = document.getElementById("newpair");
  if (!host) throw new Error("the page is missing #newpair");
  const brains = catalog.adapters.filter((adapter) => adapter.role === "brain");
  const harnesses = catalog.adapters.filter((adapter) => adapter.role === "harness");
  if (brains.length === 0 || harnesses.length === 0) {
    host.className = "empty";
    host.textContent =
      "This CLI has no registered adapters to join, so a pair cannot be made here. Run a2l adapters to see what it has.";
    return;
  }
  const options = (list: CatalogAdapter[]) =>
    list
      .map(
        (adapter) =>
          `<option value="${esc(adapter.id)}">${esc(adapter.name || adapter.id)}${
            adapter.experimental ? " (experimental)" : ""
          }</option>`
      )
      .join("");
  host.className = "";
  host.innerHTML =
    `<div class="row"><select data-brain aria-label="Brain">${options(brains)}</select>` +
    `<span class="meta">&times;</span>` +
    `<select data-harness aria-label="Harness">${options(harnesses)}</select></div>` +
    `<div class="row"><input type="text" data-workspace placeholder="Workspace folder (optional)"></div>` +
    `<div class="row"><button data-create>Create pair</button><span class="meta" data-create-out></span></div>`;
}

/**
 * The live panel shown while a run is in flight.
 *
 * The event lines are the orchestration's own operational sentences — which
 * step is being dispatched, what came back — deliberately *not* the Brain's
 * reasoning and not a transcript of the harness's chain of thought. The dock
 * shows what is happening, never what the Brain is thinking.
 */
export function formatLive(elapsedSeconds: number, state: DockState): string {
  const lines: string[] = [];
  lines.push(`${elapsedSeconds}s elapsed`);
  const tail = (state.events ?? []).slice(-6);
  for (const line of tail) lines.push(line);
  for (const pending of state.pending ?? []) lines.push(`waiting for a human: ${pending}`);
  return lines.join("\n");
}
