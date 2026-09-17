/**
 * `a2l run "<goal>"` in Relay Mode — the conversation-centric path.
 *
 * This is the product's headline command. Everything else in the CLI is
 * setup for it: a Pair exists, so this finds it, asks the Harness where it is
 * working, and hands the Brain a thread that survives the run.
 *
 * It is deliberately *not* the legacy `--brain X --harness Y` path. Those flags
 * still mean "start a brain-hands session and let the orchestrator pick the
 * workflow", which is a different promise (the Brain reviews raw evidence, the
 * Harness writes reports), and a user who typed them does not want a surprise.
 * The switch is therefore explicit in both directions:
 *
 *   a2l run "goal"                      → relay, active pair
 *   a2l run "goal" --pair <id>          → relay, that pair
 *   a2l run "goal" --relay --brain B --harness H
 *                                       → relay, find-or-create the pair
 *   a2l run --brain B --harness H       → brain-hands, unchanged
 */
import { Logger } from "@agent2llm/logger";
import { formatEventHuman, newId } from "@agent2llm/core";
import type { AdapterRegistry, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { ContextMode, HarnessContext, Pair } from "@agent2llm/pairs";
import { RelayRunner } from "@agent2llm/orchestrator";
import {
  ensurePair,
  findPairByIdentity,
  pairsStore,
  resolvePairContext,
  runsStore,
  selectPair,
} from "./pair-select.js";
import * as ui from "../ui.js";

export interface RelayOptions {
  pair?: string;
  brain?: string;
  harness?: string;
  workspace?: string;
  label?: string;
  goal?: string;
  json?: boolean;
  verbose?: boolean;
  maxIterations?: number;
  /** Set when the user passed `--ignore-auth`, which Relay cannot honour yet. */
  ignoreAuth?: boolean;
}

/** Bytes, in the units a human reads. Shared with nothing: it is two lines. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The pair this run should use, created if the user named adapters instead.
 *
 * `notes` collects everything the user should be told but that must not stop
 * the run — a harness that could not report a context, or a stored context that
 * had gone stale.
 */
async function resolvePair(
  registry: AdapterRegistry,
  options: RelayOptions,
  notes: string[]
): Promise<{ pair: Pair | null; context: HarnessContext | null; error?: string }> {
  const store = pairsStore();

  if (options.pair) {
    const { pair, error } = selectPair(store, { pairId: options.pair });
    if (!pair) return { pair: null, context: null, ...(error ? { error } : {}) };
    return { pair, context: (await applyContext(registry, pair, options, notes)).context };
  }

  if (options.brain && options.harness) {
    const mode: ContextMode = "harness-owned";
    const { context, note } = await resolvePairContext(registry, {
      harnessId: options.harness,
      workspace: options.workspace,
      mode,
    });
    const pair = ensurePair(store, {
      brainAdapterId: options.brain,
      harnessAdapterId: options.harness,
      context,
      contextMode: mode,
    });
    // `ensurePair` may have handed back a pair that already knew where it
    // works, which is exactly what a re-used pair is for. A probe that failed
    // must not turn into "no folder": the stored context is the fallback, and
    // Relay only refuses when there is none.
    const stored = pair.context?.root ? pair.context : null;
    const usable = context ?? stored;
    notes.push(usable === context ? note : `Kept this pair's stored context: ${stored?.root}. ${note}`);
    return { pair, context: usable };
  }

  const { pair, error } = selectPair(store, {});
  if (!pair) return { pair: null, context: null, ...(error ? { error } : {}) };
  return { pair, context: (await applyContext(registry, pair, options, notes)).context };
}

/**
 * Ask the Harness where it is working, and keep the answer on the pair.
 *
 * The Harness owns the context, so when it reports a folder different from the
 * one this pair remembers, the pair follows — the conversation is the Brain's
 * and it should survive the user opening a different project. The stored
 * context is still what a run falls back to when the Harness cannot answer.
 */
async function applyContext(
  registry: AdapterRegistry,
  pair: Pair,
  options: RelayOptions,
  notes: string[]
): Promise<{ pair: Pair; context: HarnessContext | null }> {
  const store = pairsStore();
  const { context, note } = await resolvePairContext(registry, {
    harnessId: pair.harnessAdapterId,
    workspace: options.workspace,
    remembered: pair.context,
    mode: pair.contextMode,
  });
  if (!context) {
    notes.push(note);
    return { pair, context: null };
  }
  if (pair.context?.id === context.id) return { pair, context };

  const clash = findPairByIdentity(store, {
    brainAdapterId: pair.brainAdapterId,
    harnessAdapterId: pair.harnessAdapterId,
    context,
  });
  if (clash && clash.pairId !== pair.pairId) {
    notes.push(
      `The harness moved to ${context.root}, which pair ${clash.pairId} already covers. ` +
        `Continuing ${pair.pairId}'s conversation there; remove the duplicate with 'a2l pair remove'.`
    );
  } else {
    notes.push(note);
  }
  return { pair: store.save({ ...pair, context }), context };
}

function reportMetrics(result: Awaited<ReturnType<RelayRunner["run"]>>): void {
  const m = result.metrics;
  const tokens = m.brainTokens;
  ui.line();
  ui.line(
    `  ${ui.bold(result.runId)} · ${result.status} · ${result.iterations} execution(s) · ` +
      `${(m.elapsedMs / 1000).toFixed(1)}s`
  );
  ui.line(`    conversation: ${result.conversation.reused ? "continued from the previous run" : "new thread"}`);
  ui.line(`    files changed: ${m.filesChanged}${m.revisions > 0 ? ` · revisions: ${m.revisions}` : ""}`);
  ui.line(
    `    brain tokens: ${tokens === null ? "unknown (not measured)" : tokens.source === "provider-reported" ? String(tokens.promptTokens + tokens.completionTokens) : `unavailable — ${tokens.reason}`}`
  );
  // Labelled "estimated text" on purpose: these are byte counts divided by four,
  // not a provider's billing counter, and calling them tokens would be a lie
  // that looks like a measurement.
  ui.line(
    ui.dim(
      `    text to harness: ${formatBytes(m.harnessInstruction.bytes)} (≈${m.harnessInstruction.estimatedTextTokens} estimated text tokens)` +
        ` · from harness: ${formatBytes(m.harnessResponse.bytes)}`
    )
  );
  ui.line(
    ui.dim(
      `    text to brain: ${formatBytes(m.brainPrompt.bytes)} (≈${m.brainPrompt.estimatedTextTokens} estimated text tokens)` +
        ` · from brain: ${formatBytes(m.brainResponse.bytes)}`
    )
  );
  const saved = m.evidenceRaw.bytes - m.evidenceCompact.bytes;
  ui.line(
    ui.dim(
      `    evidence: ${formatBytes(m.evidenceRaw.bytes)} collected → ${formatBytes(m.evidenceCompact.bytes)} sent` +
        (saved > 0 ? ` (${formatBytes(saved)} kept out of the conversation)` : "")
    )
  );
}

export async function runRelay(registry: AdapterRegistry, options: RelayOptions): Promise<number> {
  const notes: string[] = [];
  const { pair, context, error } = await resolvePair(registry, options, notes);
  if (!pair) {
    ui.fail(error ?? "No pair to run.");
    return 2;
  }

  const goal = options.goal ?? (await ui.promptText("Goal"));
  if (goal.trim() === "") {
    ui.warn("No goal supplied; nothing to do.");
    return 0;
  }

  ui.heading(`Relay — ${pair.brainAdapterId} × ${pair.harnessAdapterId}`);
  ui.line(ui.dim(`pair:    ${pair.label ? `${pair.label} (${pair.pairId})` : pair.pairId}`));
  ui.line(ui.dim(`context: ${context?.root ?? "(none)"} [${context?.source ?? "unresolved"}]`));
  ui.line(ui.dim(`policy:  ${pair.executionPolicy.mode} — the harness executes, it does not plan`));
  for (const note of notes) ui.line(ui.dim(`note:    ${note}`));
  if (options.ignoreAuth) {
    ui.line(ui.dim("note:    --ignore-auth is not used by Relay Mode; each adapter keeps its own sign-in state."));
  }
  ui.line();

  const events: string[] = [];
  const runner = new RelayRunner({
    registry,
    pairs: pairsStore(),
    runs: runsStore(),
    logger: new Logger({ name: "relay", level: options.verbose ? "debug" : "info", console: false }),
    emit: (event) => {
      events.push(formatEventHuman(event));
      if (!options.json) ui.line(`  ${formatEventHuman(event)}`);
    },
    requestUserAction: (action: UserActionRequest) => ui.requestUserAction(action),
  });

  const spin = ui.spinner("Talking to the brain");
  try {
    const result = await runner.run({
      pair,
      runId: newId("a2lr", 5),
      goal,
      context,
      ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
    });
    spin.stop();
    if (options.json) {
      ui.jsonOutput({ ...result, pairId: result.pairId, context: context?.root ?? null, notes, events });
      return result.status === "done" ? 0 : 1;
    }
    ui.line(`  ${result.status === "done" ? ui.green("✓") : ui.yellow("!")} ${result.summary}`);
    reportMetrics(result);
    return result.status === "done" ? 0 : 1;
  } catch (err) {
    spin.stop();
    ui.errorOutput(err);
    return 1;
  }
}
