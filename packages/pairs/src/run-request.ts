/**
 * Which workflow a run request belongs to.
 *
 * Two workflows ship in the same binary and they promise different things:
 *
 *   - **Relay** — a Pair, one long Brain conversation, a Harness that executes
 *     one step at a time. Chosen by `a2l run "goal"`, `--pair <id>`, `--relay`.
 *   - **brain-hands** — the original orchestrator, where the Brain reviews raw
 *     evidence and the Harness writes its own plan. Chosen by naming the two
 *     adapters (`--brain X --harness Y`), which is exactly what it always meant.
 *
 * The rule is a compatibility boundary, so it lives here — as a pure function
 * with a test on every branch — rather than inside the CLI's `switch`, where it
 * would be invisible until a user's existing command started doing something
 * else. `a2l run --brain X --harness Y` must keep working forever; the *goal as
 * a bare argument* is new, and was silently ignored before, so it is free to
 * carry the new meaning.
 *
 * One honest gap: `--goal G` alone is not a Relay trigger even though `a2l run
 * "G"` is. `--goal` predates Relay and is meaningful in both workflows, so it
 * is passed through untouched and the adapters decide. The bare argument is the
 * unambiguous way to ask for Relay.
 */

export type RunMode = "relay" | "legacy";

export interface RunRequest {
  /** `--pair <id>`: the user named a stored Pair. */
  pairId?: string | undefined;
  /** `--relay`: ask for Relay Mode without naming a Pair. */
  forceRelay?: boolean | undefined;
  brain?: string | undefined;
  harness?: string | undefined;
  workflow?: string | undefined;
  session?: string | undefined;
  /**
   * A goal typed as a bare argument — `a2l run "fix the login bug"`. This is
   * the only input that selects a workflow on its own.
   */
  positionalGoal?: string | undefined;
  /** `--goal G`, which belongs to whichever workflow runs. */
  goal?: string | undefined;
}

export interface RunDecision {
  /**
   * `rejected` is a third state on purpose: the flags contradict each other,
   * and neither workflow is right. Reporting it as one of the two valid modes
   * would mean running something the user did not ask for.
   */
  mode: RunMode | "rejected";
  /** The goal to run with. Absent means "ask the user for one". */
  goal?: string | undefined;
  /** Set only when `mode` is `rejected`. */
  error?: string | undefined;
}

export function decideRunMode(request: RunRequest): RunDecision {
  // Naming both the pair and its two halves is not a preference to be resolved:
  // whichever won, the user described a different run than the one they got.
  const namedAdapters = Boolean(request.brain || request.harness || request.workflow || request.session);
  if (request.pairId && namedAdapters) {
    return {
      mode: "rejected",
      error: "--pair already names the brain and the harness. Drop --brain/--harness/--workflow/--session.",
    };
  }

  const relay = Boolean(
    request.pairId || request.forceRelay || (request.positionalGoal !== undefined && !namedAdapters)
  );
  const goal = request.goal ?? request.positionalGoal;
  return {
    mode: relay ? "relay" : "legacy",
    ...(goal !== undefined && goal !== "" ? { goal } : {}),
  };
}
