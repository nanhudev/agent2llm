/**
 * Deterministic facts from the repository, read by Agent2LLM itself.
 *
 * This is where "the harness said it passed" becomes "the repository says
 * this changed". A harness is a program with an incentive to report success —
 * its exit code is the only part of its report this system has ever trusted,
 * and even that only says the process ended. Git says what actually moved.
 *
 * Everything here is bounded and read-only: no writes, no locks, no network.
 * A repository that is enormous, or mid-rebase, or not a repository at all,
 * degrades to fewer facts rather than to an exception.
 */
import { execFile } from "node:child_process";

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  code: number | null;
  /** True when the executable itself could not be started. */
  missing?: boolean;
}

/** Files the diff touched, as `git diff --numstat` numbers them. */
export interface GitFileChange {
  path: string;
  added: number;
  removed: number;
  /** Binary files report `-` for both counts; that is not zero lines changed. */
  binary: boolean;
}

export interface GitEvidence {
  isRepo: boolean;
  head: string | null;
  branch: string | null;
  /** `git status --porcelain` entries, verbatim. */
  status: string[];
  /** Per-file line counts, parsed rather than guessed. */
  files: GitFileChange[];
  /** `git diff --stat` summary line, kept for the record. */
  statSummary: string | null;
  /** Untracked paths, which `git diff` cannot see. */
  untracked: string[];
  clean: boolean;
  /** Why git could not be read, when it could not. */
  unavailable: string | null;
}

export const EMPTY_GIT_EVIDENCE: GitEvidence = {
  isRepo: false,
  head: null,
  branch: null,
  status: [],
  files: [],
  statSummary: null,
  untracked: [],
  clean: true,
  unavailable: null,
};

const DEFAULT_TIMEOUT_MS = 10_000;
/** Ceiling on any one git read. Evidence is a summary, not a dump. */
export const MAX_GIT_OUTPUT_CHARS = 40_000;

function runGit(root: string, args: string[], timeoutMs: number): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        "git",
        // `--no-optional-locks` keeps the read from touching `.git/index`, so
        // collecting evidence cannot race a concurrent harness operation.
        ["--no-optional-locks", "-c", "core.quotepath=false", ...args],
        { cwd: root, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          resolve({
            ok: !error,
            stdout: stdout.slice(0, MAX_GIT_OUTPUT_CHARS),
            code: error ? ((error as { code?: number }).code ?? 1) : 0,
            missing: error ? (error as { code?: string | number }).code === "ENOENT" : false,
          });
        }
      );
      child.on("error", () => resolve({ ok: false, stdout: "", code: null, missing: true }));
    } catch {
      resolve({ ok: false, stdout: "", code: null, missing: true });
    }
  });
}

function parseNumstat(output: string): GitFileChange[] {
  const files: GitFileChange[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    // "<added>\t<removed>\t<path>"; a binary file has "-" for both counts.
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    if (!path) continue;
    const binary = added === "-" || removed === "-";
    files.push({
      path,
      added: binary ? 0 : Number(added ?? 0) || 0,
      removed: binary ? 0 : Number(removed ?? 0) || 0,
      binary,
    });
  }
  return files;
}

/**
 * Reads the repository state.
 *
 * `baseRev` narrows `diff --numstat` to what changed since a known commit;
 * without one the working tree is compared against HEAD, which is the same
 * thing for a run that has not committed anything.
 */
export async function collectGitEvidence(
  root: string,
  options: { baseRev?: string | null; timeoutMs?: number } = {}
): Promise<GitEvidence> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"], timeoutMs);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    // "git is not installed" and "this folder is not a repository" are
    // different problems with different fixes, and only one of them is about
    // the user's machine. Reporting them as one message sends people looking
    // for the wrong thing.
    const missing = inside.missing === true;
    return {
      ...EMPTY_GIT_EVIDENCE,
      unavailable: missing
        ? "git is not available on this machine, so changes cannot be verified independently."
        : "This workspace is not a git repository, so changes cannot be verified independently.",
    };
  }

  const [head, branch, status, numstat, stat, untracked] = await Promise.all([
    runGit(root, ["rev-parse", "--short", "HEAD"], timeoutMs),
    runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"], timeoutMs),
    runGit(root, ["status", "--porcelain"], timeoutMs),
    options.baseRev
      ? runGit(root, ["diff", "--numstat", options.baseRev], timeoutMs)
      : runGit(root, ["diff", "--numstat", "HEAD"], timeoutMs),
    options.baseRev
      ? runGit(root, ["diff", "--stat", options.baseRev], timeoutMs)
      : runGit(root, ["diff", "--stat", "HEAD"], timeoutMs),
    runGit(root, ["ls-files", "--others", "--exclude-standard"], timeoutMs),
  ]);

  const statusLines = status.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  const statLines = stat.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");

  return {
    isRepo: true,
    head: head.ok && head.stdout.trim() !== "" ? head.stdout.trim() : null,
    branch: branch.ok && branch.stdout.trim() !== "" ? branch.stdout.trim() : null,
    status: statusLines,
    files: parseNumstat(numstat.stdout),
    // The last line of `--stat` is the "N files changed" summary.
    statSummary: statLines.length > 0 ? statLines[statLines.length - 1]!.trim() : null,
    untracked: untracked.stdout.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 200),
    clean: statusLines.length === 0,
    unavailable: null,
  };
}

/**
 * The diff of one path, for the Brain that asked to see it.
 *
 * An untracked file has no diff against HEAD — it is not in HEAD — so the
 * ordinary read returns nothing. That is exactly backwards for a reviewer:
 * a file the harness just *created* is the single most likely thing it wants
 * to look at. `git diff --no-index /dev/null <path>` produces a proper
 * new-file diff for it, which is bounded here like every other read and
 * sanitized by the caller before it travels.
 */
export async function readPathDiff(
  root: string,
  filePath: string,
  options: { maxChars?: number; timeoutMs?: number } = {}
): Promise<string> {
  const maxChars = options.maxChars ?? 8000;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // `--` separates the pathspec, so a file named like a revision is still a file.
  const diff = await runGit(root, ["diff", "HEAD", "--", filePath], timeoutMs);
  if (diff.ok && diff.stdout.trim() !== "") return diff.stdout.slice(0, maxChars);

  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "--", filePath], timeoutMs);
  if (untracked.ok && untracked.stdout.trim() !== "") {
    const asNew = await runGit(root, ["diff", "--no-index", "--", "/dev/null", filePath], timeoutMs);
    if (asNew.stdout.trim() !== "") {
      return `(new file)\n${asNew.stdout.slice(0, maxChars)}`;
    }
    return `(${filePath} is untracked and could not be read as a new file)`;
  }

  const tracked = await runGit(root, ["ls-files", "--error-unmatch", "--", filePath], timeoutMs);
  if (tracked.ok) {
    return `(no change to ${filePath} against HEAD)`;
  }
  return `(no change found for ${filePath})`;
}
