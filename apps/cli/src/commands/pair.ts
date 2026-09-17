/**
 * `a2l pair` — the Pair, which is the product's first-class noun.
 *
 * A pair is one Brain plus one Harness plus the conversation they share. It is
 * what outlives a goal: `a2l run "..."` three times against one pair is one
 * conversation with three goals in it, not three conversations.
 *
 * The command is deliberately thin. Everything it decides is either told to it
 * or read from the harness — there is no place here that picks a folder on the
 * user's behalf, because a run that edits the wrong repository looks exactly
 * like one that worked. The parts worth reading twice live in `pair-select.ts`.
 *
 * Note: `a2l pair <workspace>` is *device* pairing (PKCE between this machine
 * and the bridge) and is handled in `setup.ts`. This module answers to the
 * subcommands — `create`, `list`, `show`, `remove` — and to no arguments at
 * all, which lists. The two meanings are kept apart in `index.ts`.
 */
import type { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { CLI_PRIMARY_NAME } from "@agent2llm/config";
import { createPairCore, pairsStore, runsStore } from "./pair-select.js";
import * as ui from "../ui.js";

export interface PairOptions {
  brain?: string;
  harness?: string;
  workspace?: string;
  label?: string;
  contextMode?: string;
  json?: boolean;
  verbose?: boolean;
}

// ---- commands ----------------------------------------------------------------

export async function runPairList(options: { json?: boolean } = {}): Promise<number> {
  const store = pairsStore();
  const pairs = store.list();
  const corrupted = store.corrupted();
  if (options.json) {
    ui.jsonOutput({ pairs, corrupted });
    return 0;
  }
  if (pairs.length === 0) {
    ui.line("  No pairs yet.");
    ui.line(ui.dim(`  ${ui.bold(`${CLI_PRIMARY_NAME} pair create --brain chatgpt-web --harness codex`)}`));
    return 0;
  }
  ui.heading("Pairs");
  for (const pair of pairs) {
    const context = pair.context?.root ?? pair.context?.source ?? "(no context yet)";
    const sides = `${pair.brainAdapterId} × ${pair.harnessAdapterId}`;
    ui.line(`  ${ui.bold(pair.label ? `${pair.label} — ${sides}` : sides)}`);
    ui.line(`    context: ${context} ${ui.dim(`(${pair.contextMode})`)}`);
    ui.line(
      ui.dim(
        `    brain: ${pair.brainRef ? "connected" : "not started"}` +
          ` · harness: ${pair.harnessRef ? "seen" : "not run yet"}` +
          ` · runs: ${runsStore().byPair(pair.pairId).length}` +
          ` · ${pair.pairId}`
      )
    );
    ui.line(ui.dim(`    last run: ${pair.lastRunAt ?? "never"}`));
  }
  // An unreadable file is a pair the user thinks they have and does not.
  if (corrupted.length > 0) {
    ui.warn(`${corrupted.length} pair file(s) exist but do not parse:`);
    for (const file of corrupted) ui.line(ui.dim(`    ${file}`));
  }
  return 0;
}

export async function runPairCreate(registry: AdapterRegistry, options: PairOptions): Promise<number> {
  // The decisions live in `createPairCore` (pair-select.ts), shared with the
  // dock's creation endpoint; this command is the rendering of the outcome.
  const outcome = await createPairCore(registry, {
    brain: options.brain,
    harness: options.harness,
    workspace: options.workspace,
    label: options.label,
    contextMode: options.contextMode,
  });
  if (!outcome.ok) {
    ui.fail(outcome.error);
    return 2;
  }

  const { pair, created, note } = outcome;
  if (options.json) {
    ui.jsonOutput({ pair, created, contextNote: note });
    return 0;
  }
  if (!created) {
    ui.line(
      `  ${ui.cyan("Reusing")} pair ${pair.pairId} — this brain and harness already share a conversation here.`
    );
    ui.line(ui.dim(`  ${note}`));
    return 0;
  }

  ui.heading("Pair created");
  ui.line(`  ${pair.brainAdapterId} × ${pair.harnessAdapterId}`);
  ui.line(`  context: ${pair.context?.root ?? "(none yet)"}`);
  ui.line(ui.dim(`  ${note}`));
  ui.line();
  ui.line(ui.dim(`  ${ui.bold(`a2l run "what should they build?"`)}`));
  return 0;
}

export async function runPairShow(pairId: string | undefined, options: { json?: boolean } = {}): Promise<number> {
  const pairs = pairsStore();
  const pair = pairId ? pairs.get(pairId) : pairs.active();
  if (!pair) {
    ui.fail(pairId ? `No pair with id '${pairId}'. See 'a2l pair list'.` : "No pairs yet.");
    return 1;
  }
  const runs = runsStore().byPair(pair.pairId);
  if (options.json) {
    ui.jsonOutput({ pair, runs });
    return 0;
  }
  ui.heading(`${pair.brainAdapterId} × ${pair.harnessAdapterId}`);
  ui.line(`  id:       ${pair.pairId}`);
  ui.line(`  label:    ${pair.label ?? "(none)"}`);
  ui.line(`  context:  ${pair.context?.root ?? "(none)"} ${ui.dim(`[${pair.context?.source ?? "unset"}]`)}`);
  ui.line(`  mode:     ${pair.contextMode}`);
  ui.line(`  brain:    ${pair.brainRef ? "connected — this pair has a live conversation" : "not started"}`);
  ui.line(`  harness:  ${pair.harnessRef ? "seen" : "not run yet"}`);
  ui.line(`  policy:   ${pair.executionPolicy.mode} · cleanExecution=${pair.executionPolicy.cleanExecution}`);
  ui.line(`  created:  ${pair.createdAt}`);
  ui.line(`  last run: ${pair.lastRunAt ?? "never"}`);
  ui.line();
  if (runs.length === 0) {
    ui.line(ui.dim("  No runs yet."));
    return 0;
  }
  ui.line(`  Runs (${runs.length}):`);
  for (const run of runs.slice(0, 10)) {
    const tokens = run.metrics.brainTokens;
    const brain =
      tokens === null
        ? ui.dim("tokens unknown")
        : tokens.source === "provider-reported"
          ? `${tokens.promptTokens + tokens.completionTokens} tokens`
          : ui.dim(`tokens ${tokens.source}`);
    ui.line(
      `    ${ui.dim(run.runId)}  ${run.status.padEnd(8)} ${run.iterations} execution(s)` +
        ` · ${run.metrics.filesChanged} file(s) · ${brain}  ${ui.dim(run.goal.slice(0, 44))}`
    );
  }
  return 0;
}

export async function runPairRemove(pairId: string | undefined, options: { json?: boolean } = {}): Promise<number> {
  if (!pairId) {
    ui.fail("Which pair? 'a2l pair remove <id>' — see 'a2l pair list'.");
    return 2;
  }
  const removed = pairsStore().remove(pairId);
  if (options.json) ui.jsonOutput({ removed, pairId });
  else ui.line(removed ? `  Removed pair ${pairId}.` : `  No pair with id ${pairId}.`);
  // Removing a pair does not remove its runs: they are a record of what
  // happened, and the files are harmless — but the user should know they stayed.
  const runs = runsStore().byPair(pairId);
  if (removed && runs.length > 0 && !options.json) {
    ui.line(ui.dim(`  ${runs.length} run record(s) kept in the state directory.`));
  }
  return removed ? 0 : 1;
}
