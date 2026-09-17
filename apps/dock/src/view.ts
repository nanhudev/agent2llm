/**
 * What the dock's page looks like, as functions from data to HTML.
 *
 * Every view here takes already-typed server shapes and returns strings; the
 * dynamic values go through `esc`, and the parts that must not be escaped
 * (the page's own buttons and structure) are literals in these templates.
 * A reader can audit what reaches the page by reading this file alone.
 */
import { esc } from "./dom.js";
import type {
  ApiError,
  CatalogAdapter,
  CatalogView,
  DockState,
  PairView,
  RunMetricsView,
  RunResult,
  TextSizeView,
  UsageAccountingView,
} from "./wire.js";

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

/**
 * The creation form: two selects drawn from the real registry, nothing
 * invented — and, when the server reported what detection found, grouped so
 * the entries that can run today are visibly apart from the ones that still
 * need a product installed. An adapter the user does not have is not removed
 * from the list (it is still joinable after setup) but it is labelled, so
 * picking one is a decision, not a surprise.
 */
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
  const ready = (adapter: CatalogAdapter): boolean =>
    adapter.detection?.status === "verified" ||
    adapter.detection?.status === "detected" ||
    adapter.detection?.status === "configured" ||
    adapter.detection?.status === "authenticated";
  const option = (adapter: CatalogAdapter): string =>
    `<option value="${esc(adapter.id)}">${esc(adapter.name || adapter.id)}${
      adapter.experimental ? " (experimental)" : ""
    }${ready(adapter) ? "" : " — not installed"}</option>`;
  const options = (list: CatalogAdapter[]): string => {
    const grouped = list.some((adapter) => adapter.detection !== undefined);
    if (!grouped) return list.map(option).join("");
    const group = (label: string, items: CatalogAdapter[]): string =>
      items.length ? `<optgroup label="${esc(label)}">${items.map(option).join("")}</optgroup>` : "";
    return (
      group("On this machine", list.filter(ready)) +
      group("Needs setup", list.filter((adapter) => !ready(adapter)))
    );
  };
  host.className = "";
  host.innerHTML =
    `<div class="row"><select data-brain aria-label="Brain">${options(brains)}</select>` +
    `<span class="meta">&times;</span>` +
    `<select data-harness aria-label="Harness">${options(harnesses)}</select></div>` +
    `<div class="row"><input type="text" data-workspace placeholder="Workspace folder (optional)"></div>` +
    `<div class="row"><button data-create>Create pair</button><span class="meta" data-create-out></span></div>`;
}

/**
 * The Brain's token spend, in the only three honest forms.
 *
 * A provider-reported number is shown with its parts; "unavailable" is shown
 * with its reason; "not measured" is shown when nothing was measured. What
 * never happens is a fabricated 0: a reader who sees "0 tokens" concludes
 * the run was free, and no such conclusion is ours to hand out.
 */
export function tokensSentence(usage: UsageAccountingView | null): string {
  if (!usage) return "Brain tokens: not measured";
  if (usage.source === "provider-reported") {
    const total = usage.promptTokens + usage.completionTokens;
    const parts = `prompt ${usage.promptTokens} · completion ${usage.completionTokens}`;
    const model = usage.model ? `, model ${usage.model}` : "";
    return `Brain tokens: ${total} (provider-reported: ${parts}${model})`;
  }
  return `Brain tokens: unavailable — ${usage.reason}`;
}

function sizeSentence(size: TextSizeView): string {
  const kb = size.bytes >= 1024 ? `${(size.bytes / 1024).toFixed(1)} kB` : `${size.bytes} B`;
  return `${kb} (~${size.estimatedTextTokens} est. text tokens)`;
}

/**
 * The measured rest of the run, collapsed by default.
 *
 * Everything here is either a count the orchestrator took or a size it
 * measured on the wire. Estimates are labelled "est. text tokens" so they
 * can never be mistaken for a provider's accounting. There is deliberately
 * no cost anywhere: Agent2LLM does not know any price, so it does not
 * suggest one.
 */
export function metricsDetails(metrics: RunMetricsView): string {
  const lines: string[] = [];
  lines.push(`brain turns: ${metrics.brainTurns} · harness runs: ${metrics.harnessRuns} · revisions: ${metrics.revisions}`);
  if (metrics.harnessUsage) {
    lines.push(
      metrics.harnessUsage.source === "provider-reported"
        ? `harness usage: ${metrics.harnessUsage.promptTokens + metrics.harnessUsage.completionTokens} (provider-reported)`
        : `harness usage: unavailable — ${metrics.harnessUsage.reason}`
    );
  }
  lines.push(`tests: ${metrics.testsPassed === null ? "not measured" : `${metrics.testsPassed} passed`}`);
  lines.push(`evidence given to the Brain: raw ${sizeSentence(metrics.evidenceRaw)}, compact ${sizeSentence(metrics.evidenceCompact)}`);
  lines.push(`prompts to the Brain: ${sizeSentence(metrics.brainPrompt)} · responses: ${sizeSentence(metrics.brainResponse)}`);
  lines.push(`instructions to the Harness: ${sizeSentence(metrics.harnessInstruction)} · responses: ${sizeSentence(metrics.harnessResponse)}`);
  return `<details class="metrics"><summary>Metrics</summary><pre>${esc(lines.join("\n"))}</pre></details>`;
}

/** The whole outcome panel for a finished run. */
export function renderRunResult(out: HTMLElement, result: RunResult): void {
  const head =
    `<div><span class="${esc(result.status)}">${esc(result.status.toUpperCase())}</span> — ${esc(result.summary)}</div>` +
    `<div class="meta">run <code>${esc(result.runId)}</code> · ${esc(result.iterations)} execution(s) · ` +
    `${esc(result.metrics.filesChanged)} file(s) changed · ${esc((result.metrics.elapsedMs / 1000).toFixed(1))}s · ` +
    `${result.conversation.reused ? "continued the same Brain conversation" : "new Brain thread"}</div>` +
    `<div class="meta">${esc(tokensSentence(result.metrics.brainTokens))}</div>`;
  const approvals =
    result.pendingApprovals && result.pendingApprovals.length > 0
      ? `<div class="meta">The harness asked for a human:<br>${esc(result.pendingApprovals.join("\n")).replace(
          /\n/g,
          "<br>"
        )}<br>This page cannot answer approvals — re-run the goal from a terminal, where the prompt can be answered.</div>`
      : "";
  out.innerHTML = `<div class="result">${head}${approvals}${metricsDetails(result.metrics)}</div>`;
}

/**
 * A failed run, as an answer rather than a dead end.
 *
 * The shape is deliberate: **what** failed (the server's own sentence),
 * **where** (the pair it was asked of), and **next** (the server's hint when
 * it has one — never advice invented here). The raw message stays reachable
 * in a collapsed details block, because sometimes the sentence above it is
 * not the sentence a person needed.
 */
export function renderRunError(out: HTMLElement, pairId: string, error: ApiError): void {
  const next =
    error.hint ??
    "Re-run the goal, or run it from a terminal, where an approval prompt can be answered.";
  out.innerHTML =
    '<div class="err">' +
    '<div class="err-title">Run failed</div>' +
    `<div><strong>What:</strong> ${esc(error.message)}</div>` +
    `<div><strong>Where:</strong> pair <code>${esc(pairId)}</code></div>` +
    `<div><strong>Next:</strong> ${esc(next)}</div>` +
    `<details><summary>Details</summary><pre>${esc(error.message)}</pre></details>` +
    "</div>";
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
