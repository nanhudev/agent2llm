/**
 * Picking a Pair, and working out where it lives.
 *
 * Split out of `pair.ts` because the two jobs pull in opposite directions: the
 * commands in that file talk to a user, and this file is the part that can be
 * reasoned about on its own. It is also where the decisions that must not be
 * guessed live, so keeping them together makes one place to read.
 *
 * There is no place here that picks a folder on the user's behalf: a context
 * arrives from the harness, from `--workspace`, or from what the pair already
 * remembered — never from the process working directory.
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
  type ReportedContext,
} from "@agent2llm/pairs";

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
export function parseMode(value: string | undefined): ContextMode | null {
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
  let reported: ReportedContext | null = null;
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

  // An adapter that looked and found nothing still knows *why*, and that
  // sentence is more use than "no context". A report with a root has a note
  // too — the basis it was derived from — and it is more specific than the
  // generic "reported by the harness", so it is preferred when it applies.
  const adapterNote = reported?.note?.trim();
  const adapterSpoke = adapterNote && (resolved.context?.source === "harness" || !resolved.context);

  // `resolveContext` does not know where a root came from beyond "an A2L
  // record". When that record is this pair's own memory, say so — "reusing what
  // this pair already knew" is a different sentence from "reading a workspace
  // list", and only one of them tells the user why nothing was asked.
  const fromMemory =
    !options.workspace &&
    !reported?.root &&
    resolved.context?.source === "a2l" &&
    resolved.context.root === options.remembered?.root;

  const note = adapterSpoke
    ? `${askNote}${adapterNote}`
    : fromMemory
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
 *
 * A context that could not be read is not a *different* context, and this is
 * the case that used to fork: a harness whose probe fails once — Codex before
 * it has any rollouts, a temporarily unreadable state directory — resolved to
 * `null`, `pairIdentity` called that `no-context`, and the next `pair create`
 * wrote a second pair for the same brain and harness. Matching on the two
 * adapters alone when there is no context to match on is the fix: with nothing
 * to tell them apart, a second pair cannot be told apart either, and the
 * stored context is still there for the run to fall back to.
 */
export function findPairByIdentity(
  pairs: PairStore,
  input: { brainAdapterId: string; harnessAdapterId: string; context: HarnessContext | null }
): Pair | null {
  const list = pairs.list();
  const exact = list.find((pair) => pairIdentity(pair) === pairIdentity(input));
  if (exact) return exact;
  if (input.context !== null) return null;
  const sameSides = list.filter(
    (pair) => pair.brainAdapterId === input.brainAdapterId && pair.harnessAdapterId === input.harnessAdapterId
  );
  return (
    [...sameSides].sort((a, b) => (b.lastRunAt ?? b.updatedAt).localeCompare(a.lastRunAt ?? a.updatedAt))[0] ?? null
  );
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

type Role = "brain" | "harness";

/** Which side of the registry an id lives on, or `null` if it is not there. */
export function roleOf(registry: AdapterRegistry, id: string): Role | null {
  if (registry.listBrains().some((adapter) => adapter.metadata().id === id)) return "brain";
  if (registry.listHarnesses().some((adapter) => adapter.metadata().id === id)) return "harness";
  return null;
}
