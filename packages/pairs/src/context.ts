/**
 * Where the Harness is working.
 *
 * The rule this file exists to enforce: **the Harness owns the context.** A
 * coding agent that already has a project open has already answered "which
 * folder?" — asking the user again is the bug Relay Mode was built to remove.
 *
 * The second rule is that an unknown context must stay unknown. A wrong root
 * is worse than no root: a run that writes to the wrong repository looks like
 * it succeeded.
 */
import path from "node:path";
import type { ContextMode, HarnessContext } from "./model.js";

/** What an adapter is allowed to report, before normalisation. */
export interface ReportedContext {
  root?: string;
  displayName?: string;
  confidence?: number;
  detail?: Record<string, string | number | boolean>;
  /** The adapter's own sentence, including why it could not name a root. */
  note?: string;
}

export function contextFromRoot(input: {
  root: string;
  source: HarnessContext["source"];
  displayName?: string;
  confidence?: number;
  detail?: Record<string, string | number | boolean>;
}): HarnessContext {
  const root = path.resolve(input.root);
  return {
    id: root,
    displayName: input.displayName ?? path.basename(root),
    root,
    source: input.source,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    detail: input.detail ?? {},
  };
}

export function contextIdForRoot(root: string): string {
  return path.resolve(root);
}

export interface ContextResolutionInput {
  /** The Harness adapter's own answer, when it can produce one. */
  reported: ReportedContext | null;
  /**
   * A root Agent2LLM already knows about (a workspace record, a `--workspace`
   * flag from a previous run, the pair's own memory). Used only when nothing
   * more specific applies.
   */
  fallbackRoot?: string | undefined;
  /** A folder the human named on this command. Wins outright. */
  userRoot?: string | undefined;
  /**
   * `harness-owned` (relay default) trusts the Harness over Agent2LLM's record;
   * `a2l-workspace` (legacy brain-hands) keeps Agent2LLM's record first.
   */
  mode: ContextMode;
}

export interface ContextResolution {
  context: HarnessContext | null;
  /**
   * Why the context is missing or came from somewhere else. Always populated
   * with a sentence a user can act on, because "context detection unavailable"
   * on its own tells them nothing about what to do.
   */
  note: string;
}

/**
 * Resolves the context in priority order, and explains the outcome.
 *
 * No guessing: every branch that returns a context can point at who said so.
 */
export function resolveContext(input: ContextResolutionInput): ContextResolution {
  if (input.mode === "none") {
    return { context: null, note: "This pair runs without a context (mode: none)." };
  }

  // A reported context with no root is not a context. Resolving "" would land
  // on the process cwd, which is a guess wearing a path as a disguise.
  const fromHarness =
    input.reported?.root && input.reported.root.trim() !== ""
      ? contextFromRoot({
          root: input.reported.root,
          source: "harness",
          ...(input.reported.displayName !== undefined ? { displayName: input.reported.displayName } : {}),
          ...(input.reported.confidence !== undefined ? { confidence: input.reported.confidence } : {}),
          ...(input.reported.detail !== undefined ? { detail: input.reported.detail } : {}),
        })
      : null;

  const fromUser = input.userRoot ? contextFromRoot({ root: input.userRoot, source: "user" }) : null;
  const fromA2L = input.fallbackRoot ? contextFromRoot({ root: input.fallbackRoot, source: "a2l" }) : null;

  // A folder the user named wins in both modes, and that is a correction rather
  // than a detail. `--workspace` is not the user *answering a question* the
  // harness already answered — it is the user overriding the default, and the
  // default had been beating it. The failure was silent: Codex's last session
  // was in D:\Chat2Blend, so `a2l run "..." --workspace D:\my-repo` edited
  // D:\Chat2Blend while reporting success. Only an explicitly typed flag reaches
  // this branch, so there is no accidental override to protect against.
  const ordered =
    input.mode === "harness-owned"
      ? [fromUser, fromHarness, fromA2L]
      : [fromA2L, fromUser, fromHarness];

  const chosen = ordered.find((candidate): candidate is HarnessContext => candidate !== null);
  if (!chosen) {
    return {
      context: null,
      note:
        "No context: the harness did not report a project and no workspace is configured. " +
        "Pass --workspace <path> or choose a folder in the pairing dock.",
    };
  }

  switch (chosen.source) {
    case "harness":
      return {
        context: chosen,
        note: `Context from ${chosen.displayName ?? chosen.id} (reported by the harness).`,
      };
    case "user":
      return { context: chosen, note: `Context chosen by the user: ${chosen.root}` };
    default:
      return {
        context: chosen,
        note: `Context from Agent2LLM's workspace record: ${chosen.root}`,
      };
  }
}
