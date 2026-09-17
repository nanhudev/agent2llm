/**
 * One Relay goal, resolved and run.
 *
 * Extracted from `runRelay` so that `a2l dock` starts runs through the same
 * code path as `a2l run`. The alternative — a second implementation inside the
 * dock's request handler — would have duplicated the context resolution, which
 * is the part carrying the subtlest rules in the CLI: which source wins, when a
 * pair follows the harness to a new folder, and when a stored context is the
 * only thing left to run in. Two copies of that would drift, and the drift
 * would be silent.
 *
 * Everything here returns values; nothing here prints. `runRelay` prints, the
 * dock serialises.
 */
import { Logger, nullLogger } from "@agent2llm/logger";
import { newId, formatEventHuman } from "@agent2llm/core";
import type { AdapterRegistry, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { ContextMode, HarnessContext, Pair } from "@agent2llm/pairs";
import { RelayRunner, type RelayRunResult } from "@agent2llm/orchestrator";
import {
  ensurePair,
  findPairByIdentity,
  pairsStore,
  resolvePairContext,
  runsStore,
  selectPair,
} from "./pair-select.js";

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

export interface RelayHooks {
  /**
   * Called once the pair is known and before a single step is dispatched.
   *
   * Exists so the CLI can print "which pair, which folder, under which policy"
   * *before* the run rather than after it: a user watching a long dispatch
   * needs to know where it is happening while it is happening.
   */
  onResolved?: (info: { pair: Pair; context: HarnessContext | null; notes: string[] }) => void;
  /** One human-readable line per orchestration event. */
  onEvent?: (line: string) => void;
  /**
   * How to answer a harness that wants a human.
   *
   * Left to the caller because the two callers differ: the CLI can block on a
   * prompt, and a request handler in the dock must not, or one unattended
   * approval request would hang the page.
   */
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

export type RelayGoalOutcome =
  | { ok: true; pair: Pair; context: HarnessContext | null; notes: string[]; result: RelayRunResult }
  | { ok: false; error: string };

/**
 * The pair this run should use, created if the user named adapters instead.
 *
 * `notes` collects everything the user should be told but that must not stop
 * the run — a harness that could not report a context, or a stored context that
 * had gone stale.
 */
async function prepareRelay(
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

/**
 * Resolve the pair, then run one goal through it.
 *
 * Never throws for a run that failed: a failure is the run's status, and both
 * callers render it. It *does* let a thrown adapter error escape, because that
 * is not a run outcome either caller can describe.
 */
export async function runRelayGoal(
  registry: AdapterRegistry,
  options: RelayOptions,
  hooks: RelayHooks = {}
): Promise<RelayGoalOutcome> {
  const notes: string[] = [];
  const { pair, context, error } = await prepareRelay(registry, options, notes);
  if (!pair) return { ok: false, error: error ?? "No pair to run." };

  const goal = options.goal?.trim() ?? "";
  if (goal === "") return { ok: false, error: "No goal supplied; nothing to do." };

  hooks.onResolved?.({ pair, context, notes });

  const runner = new RelayRunner({
    registry,
    pairs: pairsStore(),
    runs: runsStore(),
    logger: options.verbose
      ? new Logger({ name: "relay", level: "debug", console: false })
      : nullLogger,
    ...(hooks.onEvent ? { emit: (event) => hooks.onEvent!(formatEventHuman(event)) } : {}),
    ...(hooks.requestUserAction ? { requestUserAction: hooks.requestUserAction } : {}),
  });

  const result = await runner.run({
    pair,
    runId: newId("a2lr", 5),
    goal,
    context,
    ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
  });

  return { ok: true, pair, context, notes, result };
}
