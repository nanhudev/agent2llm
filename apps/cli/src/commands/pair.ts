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
 * like one that worked.
 *
 * Note: `a2l pair <workspace>` is *device* pairing (PKCE between this machine
 * and the bridge) and is handled in `setup.ts`. This module answers to the
 * subcommands — `create`, `list`, `show`, `remove` — and to no arguments at
 * all, which lists. The two meanings are kept apart in `index.ts`.
 */
import { newId } from "@agent2llm/core";
import type { AdapterRegistry } from "@agent2llm/adapter-sdk";
import {
  CONTEXT_MODES,
  PairStore,
  RunStore,
  createPair,
  pairIdentity,
  resolveContext,
  type ContextMode,
  type HarnessContext,
  type Pair,
} from "@agent2llm/pairs";
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

export function pairsStore(): PairStore {
  return new PairStore();
}

export function runsStore(): RunStore {
  return new RunStore();
}

export function newPairId(): string {
  return newId("a2lp", 5);
}

/** `null` when the user typed something that is not a context mode. */
function parseMode(value: string | undefined): ContextMode | null {
  if (value === undefined) return "harness-owned";
  return (CONTEXT_MODES as readonly string[]).includes(value) ? (value as ContextMode) : null;
}

/**
 * Where this pair should work.
 *
 * The order is the product decision. A Harness that can say which project it
 * has open is believed first; a `--workspace` the user typed next; the pair's
 * remembered context last, so a pair created once keeps working without being
 * re-told where it lives.
 *
 * `note` is always populated, so "we could not tell" reaches the user as a
 * sentence with a way out rather than as an absence.
 */
export async function resolvePairContext(
  registry: AdapterRegistry,
  options: {
    harnessId: string;
    workspace?: string | undefined;
    remembered?: HarnessContext | null;
    mode?: ContextMode;
  }
): Promise<{ context: HarnessContext | null; note: string }> {
  const mode = options.mode ?? "harness-owned";
  let reported: { root?: string } | null = null;
  let askNote = "";

  if (mode !== "none") {
    try {
      const harness = registry.getHarness(options.harnessId);
      reported = (await harness.getActiveContext?.()) ?? null;
    } catch (error) {
      // An adapter that throws here has not answered the question, which is
      // different from answering "nowhere" — and both are different from a
      // guess, so the exception is recorded rather than swallowed.
      askNote = `The harness could not report its context: ${(error as Error).message}. `;
    }
  }

  const resolved = resolveContext({
    reported,
    ...(options.workspace ? { userRoot: options.workspace } : {}),
    ...(options.remembered?.root ? { fallbackRoot: options.remembered.root } : {}),
    mode,
  });

  // `resolveContext` does not know where a root came from beyond "an A2L
  // record". When that record is this pair's own memory, say so — "reusing what
  // this pair already knew" is a different sentence from "reading a workspace
  // list", and only one of them tells the user why nothing was asked.
  const fromMemory =
    !options.workspace &&
    !reported?.root &&
    resolved.context?.source === "a2l" &&
    resolved.context.root === options.remembered?.root;

  const note = fromMemory
    ? `${askNote}Reusing this pair's stored context: ${resolved.context?.root}`
    : `${askNote}${resolved.note}`;
  return { context: resolved.context, note };
}

/**
 * The pair a bare `a2l run` should use, found by identity rather than by id.
 *
 * A `--brain`/`--harness` invocation that happens to match an existing pair is
 * a *continuation* of it, not a new one. Creating a second pair with the same
 * two adapters and the same context would silently start a new conversation,
 * which is precisely the thing Relay exists to avoid.
 */
export function findPairByIdentity(
  pairs: PairStore,
  input: { brainAdapterId: string; harnessAdapterId: string; context: HarnessContext | null }
): Pair | null {
  const wanted = pairIdentity(input);
  return pairs.list().find((pair) => pairIdentity(pair) === wanted) ?? null;
}

/** Find-or-create, so `--relay --brain X --harness Y` does not fork a thread. */
export function ensurePair(
  pairs: PairStore,
  input: {
    brainAdapterId: string;
    harnessAdapterId: string;
    context: HarnessContext | null;
    contextMode?: ContextMode;
    label?: string;
  }
): Pair {
  const existing = findPairByIdentity(pairs, input);
  if (existing) return existing;
  const created = createPair({
    pairId: newPairId(),
    brainAdapterId: input.brainAdapterId,
    harnessAdapterId: input.harnessAdapterId,
    ...(input.contextMode ? { contextMode: input.contextMode } : {}),
    ...(input.label ? { label: input.label } : {}),
  });
  // One write, with the context already on it: a pair that exists without the
  // context it was created for is a pair the next run has to re-ask about.
  return pairs.save(input.context ? { ...created, context: input.context } : created);
}

type Role = "brain" | "harness";

/** Which side of the registry an id lives on, or `null` if it is not there. */
function roleOf(registry: AdapterRegistry, id: string): Role | null {
  if (registry.listBrains().some((adapter) => adapter.metadata().id === id)) return "brain";
  if (registry.listHarnesses().some((adapter) => adapter.metadata().id === id)) return "harness";
  return null;
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
    ui.line(ui.dim(`  ${ui.bold("a2l pair create --brain chatgpt-web --harness codex")}`));
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
  if (!options.brain || !options.harness) {
    ui.fail("A pair needs both sides: --brain <id> and --harness <id>.");
    return 2;
  }
  const wanted: Array<{ flag: string; id: string; role: Role }> = [
    { flag: "--brain", id: options.brain, role: "brain" },
    { flag: "--harness", id: options.harness, role: "harness" },
  ];
  for (const side of wanted) {
    const actual = roleOf(registry, side.id);
    if (actual === null) {
      ui.fail(`Unknown adapter '${side.id}'. Run 'a2l adapters' to see what is registered.`);
      return 2;
    }
    // Naming the flag that is wrong is the difference between a typo and a
    // mystery: `--harness chatgpt-web` is a small mistake with a large symptom.
    if (actual !== side.role) {
      ui.fail(`'${side.id}' is a ${actual}, not a ${side.role}. ${side.flag} needs a ${side.role} id.`);
      return 2;
    }
  }

  const mode = parseMode(options.contextMode);
  if (mode === null) {
    ui.fail(`--context-mode must be one of: ${CONTEXT_MODES.join(", ")}.`);
    return 2;
  }

  const { context, note } = await resolvePairContext(registry, {
    harnessId: options.harness,
    workspace: options.workspace,
    mode,
  });

  const existing = findPairByIdentity(pairsStore(), {
    brainAdapterId: options.brain,
    harnessAdapterId: options.harness,
    context,
  });
  if (existing) {
    if (options.json) {
      ui.jsonOutput({ pair: existing, created: false, contextNote: note });
      return 0;
    }
    ui.line(`  ${ui.cyan("Reusing")} pair ${existing.pairId} — this brain and harness already share a conversation here.`);
    ui.line(ui.dim(`  ${note}`));
    return 0;
  }

  const pair = ensurePair(pairsStore(), {
    brainAdapterId: options.brain,
    harnessAdapterId: options.harness,
    context,
    contextMode: mode,
    ...(options.label ? { label: options.label } : {}),
  });

  if (options.json) {
    ui.jsonOutput({ pair, created: true, contextNote: note });
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

/** Picks a pair from whatever the user named: an id, adapters, or nothing. */
export function selectPair(
  pairs: PairStore,
  options: { pairId?: string | undefined; brain?: string | undefined; harness?: string | undefined }
): { pair: Pair | null; error?: string } {
  if (options.pairId) {
    const pair = pairs.get(options.pairId);
    return pair ? { pair } : { pair: null, error: `No pair with id '${options.pairId}'. See 'a2l pair list'.` };
  }
  if (options.brain && options.harness) {
    const matches = pairs
      .list()
      .filter((pair) => pair.brainAdapterId === options.brain && pair.harnessAdapterId === options.harness);
    if (matches.length === 0) {
      return { pair: null, error: `No pair joins ${options.brain} with ${options.harness} yet.` };
    }
    // More than one means the same two adapters in different folders. The most
    // recently used one is the one the user was last looking at.
    const sorted = [...matches].sort((a, b) => (b.lastRunAt ?? b.updatedAt).localeCompare(a.lastRunAt ?? a.updatedAt));
    return { pair: sorted[0]! };
  }
  const active = pairs.active();
  if (!active) {
    return {
      pair: null,
      error: "No pairs yet. Create one with 'a2l pair create --brain <id> --harness <id>'.",
    };
  }
  return { pair: active };
}

export async function runPairShow(pairId: string | undefined, options: { json?: boolean } = {}): Promise<number> {
  const pairs = pairsStore();
  const { pair, error } = selectPair(pairs, { pairId });
  if (!pair) {
    ui.fail(error ?? "No such pair.");
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
