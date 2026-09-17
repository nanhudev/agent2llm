/**
 * The evidence for one execution, assembled by Agent2LLM.
 *
 * Two things make this evidence rather than a report:
 *
 * 1. It is read from the repository, not from the harness. The harness
 *    supplies its exit status and its own account; git supplies what moved.
 * 2. When the two disagree, the disagreement is recorded rather than
 *    resolved in the harness's favour.
 *
 * The second point is the reason `verdict` exists. An agent that says
 * "done, 6 tests pass" while the working tree is untouched has either done
 * nothing or is describing a state that does not exist — and either way the
 * Brain reviewing it should be told before it decides the task is finished.
 */
import type { ExecutionResult } from "@agent2llm/adapter-sdk";
import { measureTextSize, type ExecutionReceipt, type TextSize } from "@agent2llm/pairs";
import { collectGitEvidence, EMPTY_GIT_EVIDENCE, type GitEvidence } from "./git.js";

export type VerificationVerdict = "corroborated" | "unverified" | "contradicted";

export interface CollectedEvidence {
  collectedAt: string;
  workspaceRoot: string;
  git: GitEvidence;
  receipt: ExecutionReceipt;
  /**
   * What git can vouch for. Not "is the task done" — that is the Brain's call,
   * and this system does not have an opinion about it.
   */
  verdict: VerificationVerdict;
  /** One sentence explaining the verdict, in the language of the facts. */
  verdictReason: string;
  /** Files the harness named that git does not show as changed. */
  claimedButUnchanged: string[];
  /** Files git shows as changed that the harness never mentioned. */
  changedButUnclaimed: string[];
}

/**
 * Reads a test count out of whatever the harness put in `tests`.
 *
 * Deliberately narrow. "18 passed" and "18 passed, 2 failed" both yield 18;
 * anything that does not contain a number next to the word "pass" yields
 * `null`, because a guessed count is worse than an admitted gap.
 */
export function parseTestsPassed(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(\d+)\s*(?:tests?\s*)?pass(?:ed|ing)?\b/i.exec(text) ?? /pass(?:ed|ing)?\s*[:\s]\s*(\d+)\b/i.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export interface CollectEvidenceInput {
  workspaceRoot: string;
  receipt: ExecutionReceipt;
  /** Skip the git read entirely (used by tests and non-git harnesses). */
  skipGit?: boolean;
  baseRev?: string | null;
  timeoutMs?: number;
}

/**
 * Assembles the evidence record.
 *
 * Never throws: a failed git read becomes `unavailable` in the record, because
 * "we could not verify" is a fact the Brain needs and an exception in the
 * middle of a run is not.
 */
export async function collectEvidence(input: CollectEvidenceInput): Promise<CollectedEvidence> {
  const git = input.skipGit
    ? { ...EMPTY_GIT_EVIDENCE, unavailable: "Evidence collection skipped for this execution." }
    : await collectGitEvidence(input.workspaceRoot, {
        baseRev: input.baseRev ?? null,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });

  const changed = new Set(git.files.map((file) => normalizePath(file.path)));
  for (const file of git.untracked) changed.add(normalizePath(file));
  const claimed = new Set(input.receipt.changedFiles.map(normalizePath));

  const claimedButUnchanged = [...claimed].filter((file) => !changed.has(file));
  const changedButUnclaimed = [...changed].filter((file) => !claimed.has(file));

  const { verdict, verdictReason } = judge(input.receipt, git, claimed, changed);

  return {
    collectedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    git,
    receipt: input.receipt,
    verdict,
    verdictReason,
    claimedButUnchanged,
    changedButUnclaimed,
  };
}

function judge(
  receipt: ExecutionReceipt,
  git: GitEvidence,
  claimed: Set<string>,
  changed: Set<string>
): { verdict: VerificationVerdict; verdictReason: string } {
  if (!git.isRepo) {
    return {
      verdict: "unverified",
      verdictReason:
        git.unavailable ??
        "No repository to read, so the harness's account could not be checked against the working tree.",
    };
  }

  // The lie detector. A success that names files, in a tree where nothing at
  // all moved, is a claim the repository contradicts.
  if (receipt.status === "success" && claimed.size > 0 && git.clean && changed.size === 0) {
    return {
      verdict: "contradicted",
      verdictReason:
        `The harness reported success and named ${claimed.size} changed file(s), but the working tree at ` +
        `${git.head ?? "HEAD"} is clean — nothing changed.`,
    };
  }

  if (receipt.status === "success" && changed.size === 0) {
    return {
      verdict: "corroborated",
      verdictReason:
        "The harness reported success and the tree is unchanged, which is consistent with a step that had " +
        "nothing to write.",
    };
  }

  if (claimed.size > 0) {
    const matched = [...claimed].filter((file) => changed.has(file)).length;
    const unmatched = claimed.size - matched;
    return {
      verdict: "corroborated",
      verdictReason:
        `${matched}/${claimed.size} claimed file(s) are confirmed by the working tree` +
        (unmatched > 0 ? `; ${unmatched} could not be confirmed.` : "."),
    };
  }

  return {
    verdict: "corroborated",
    verdictReason:
      changed.size > 0
        ? `The working tree shows ${changed.size} changed path(s), which the harness did not enumerate.`
        : "The working tree is unchanged.",
  };
}

/**
 * Builds the receipt for one execution from what the harness returned.
 *
 * The summary is capped here rather than at the point of display, so an
 * over-long agent narration can never be the thing that fills the Brain's
 * context — and so the cap is visible in the stored record instead of being
 * applied silently downstream.
 */
export function buildReceipt(input: {
  receiptId: string;
  runId: string;
  iteration: number;
  result: Pick<ExecutionResult, "ok" | "exitStatus" | "changedFiles" | "tests" | "summary" | "commands" | "durationMs">;
  errors?: string[];
  maxSummaryChars: number;
}): ExecutionReceipt {
  const files = Array.isArray(input.result.changedFiles)
    ? input.result.changedFiles.slice(0, 400)
    : [];
  const summary = input.result.summary.trim();
  return {
    receiptId: input.receiptId,
    runId: input.runId,
    iteration: input.iteration,
    status: input.result.ok ? "success" : "failure",
    exitStatus: String(input.result.exitStatus ?? "unknown").slice(0, 120),
    changedFiles: files,
    tests: input.result.tests ? input.result.tests.slice(0, 300) : null,
    testsPassed: parseTestsPassed(input.result.tests),
    commands: (input.result.commands ?? []).slice(0, 40),
    errors: (input.errors ?? []).slice(0, 20),
    summary: summary.slice(0, input.maxSummaryChars),
    durationMs: Math.max(0, Math.round(input.result.durationMs ?? 0)),
    at: new Date().toISOString(),
  };
}

/** Sizes for the run metrics: the raw record, and the compressed form. */
export interface EvidenceSizes {
  raw: TextSize;
  compact: TextSize;
}

export function evidenceSizes(raw: CollectedEvidence, compact: string): EvidenceSizes {
  return {
    raw: measureTextSize(JSON.stringify(raw)),
    compact: measureTextSize(compact),
  };
}
