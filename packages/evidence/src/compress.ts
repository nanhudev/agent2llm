/**
 * Getting evidence into a Brain's context without filling it.
 *
 * The failure this prevents is arithmetic. A run that touched twelve files has
 * a diff in the tens of thousands of tokens. Sending that to a web Brain on
 * every iteration is how a "cheaper" pairing becomes an expensive one, and it
 * is not even useful: a reviewer deciding whether to accept a step needs the
 * file list, the test result and the exit status, and needs the diff only for
 * the parts it cannot judge from those.
 *
 * So the default is a compact form — a few hundred characters — and the Brain
 * can ask for one specific diff afterwards by name:
 *
 *     SHOW_DIFF src/auth.ts
 *
 * That request is parsed here and answered by `readPathDiff`, which reads from
 * the repository rather than from anything the harness said.
 */
import { MAX_RECEIPT_SUMMARY_CHARS } from "@agent2llm/pairs";
import { sanitizeOutput } from "@agent2llm/execution";
import { readPathDiff } from "./git.js";
import type { CollectedEvidence } from "./collect.js";

/** Ceiling on the compact form. It is a summary; if it needs more, it is wrong. */
export const MAX_COMPACT_CHARS = 1600;
/** Files listed before the rest are summarised as a count. */
export const MAX_COMPACT_FILES = 40;
/** Ceiling on one on-demand diff. */
export const MAX_DETAIL_CHARS = 8000;

/**
 * The compact form the Brain receives by default.
 *
 * Shape follows the order a reviewer reads in: what changed, whether it
 * passed, what was run, how it ended, what went wrong.
 */
export function compressEvidence(evidence: CollectedEvidence, maxChars = MAX_COMPACT_CHARS): string {
  const { receipt, git } = evidence;
  const lines: string[] = [`Execution #${receipt.iteration}`, ""];

  // Two different claims are possible here and they must not look alike: a
  // list verified against the working tree, and a list the harness supplied
  // that nothing could check. A run in a plain folder would otherwise present
  // the harness's own account as though git had confirmed it.
  const verified = git.isRepo;
  const listed: { path: string; note: string }[] = [];
  const seen = new Set<string>();
  const add = (rawPath: string, note: string) => {
    const path = normalizeSlashes(rawPath);
    if (path === "" || seen.has(path)) return;
    seen.add(path);
    listed.push({ path, note });
  };

  if (verified) {
    for (const file of git.files) {
      // An untracked file has no line counts at all — `git diff` cannot see it
      // — so "(new)" is the truth where "+0/-0" would read like an empty change.
      add(file.path, file.binary ? " (binary)" : ` (+${file.added}/-${file.removed})`);
    }
    for (const file of git.untracked) add(file, " (new)");
    // A path the harness named that git did not list at all: shown, marked, so
    // the Brain can see the claim was not confirmed rather than assume it was.
    for (const file of evidence.claimedButUnchanged) add(file, " (claimed, unconfirmed)");
  } else {
    // No repository: the harness's list is all there is, and the heading below
    // says exactly that.
    for (const file of receipt.changedFiles) add(file, "");
  }

  lines.push(verified ? "Changed (verified by git):" : "Changed (claimed by the harness, unverified):");
  if (listed.length === 0) {
    lines.push(git.isRepo ? "- (nothing — the working tree is clean)" : "- (nothing claimed)");
  } else {
    for (const entry of listed.slice(0, MAX_COMPACT_FILES)) lines.push(`- ${entry.path}${entry.note}`);
    if (listed.length > MAX_COMPACT_FILES) lines.push(`- ... and ${listed.length - MAX_COMPACT_FILES} more`);
  }

  lines.push("", "Tests:", receipt.tests ?? "(none reported)");
  lines.push("", "Commands:", receipt.commands.length > 0 ? receipt.commands.join("\n") : "(none reported)");
  lines.push("", "Status:", `${receipt.status} (exit ${receipt.exitStatus})`);
  lines.push("", "Verification:", `${evidence.verdict} — ${evidence.verdictReason}`);
  lines.push("", "Errors:", receipt.errors.length > 0 ? receipt.errors.join("\n") : "none");

  if (evidence.changedButUnclaimed.length > 0) {
    lines.push(
      "",
      `Changed but not named by the harness (${evidence.changedButUnclaimed.length}):`,
      ...evidence.changedButUnclaimed.slice(0, 10).map((file) => `- ${file}`)
    );
  }
  if (evidence.claimedButUnchanged.length > 0) {
    lines.push(
      "",
      `Claimed but not confirmed by the repository (${evidence.claimedButUnchanged.length}):`,
      ...evidence.claimedButUnchanged.slice(0, 10).map((file) => `- ${file}`)
    );
  }

  if (verified && listed.length > 0) {
    lines.push("", "Ask for a diff with: SHOW_DIFF <path>");
  }

  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n(truncated)`;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** A Brain's request for detail, parsed out of its reply. */
export interface EvidenceDetailRequest {
  file: string;
}

/**
 * Finds `SHOW_DIFF <path>` in a Brain's response.
 *
 * Takes the last occurrence: a Brain that first asks for one file and then
 * changes its mind should get what it asked for last, in both the request and
 * the answer.
 */
export function parseDetailRequest(text: string): EvidenceDetailRequest | null {
  const matches = [...text.matchAll(/SHOW_DIFF\s*:?\s*(\S[^\n\r]*)/gi)];
  const last = matches[matches.length - 1]?.[1];
  if (!last) return null;
  const file = last.trim().replace(/^["'`]|["'`]$/g, "");
  return file === "" ? null : { file };
}

export interface DetailResult {
  file: string;
  text: string;
}

/**
 * Answers a detail request from the repository.
 *
 * Returns an explanation instead of nothing when the path is not a change, so
 * a Brain that asked about the wrong file learns that rather than concluding
 * the run produced no output.
 */
export async function renderDetail(
  evidence: CollectedEvidence,
  request: EvidenceDetailRequest,
  options: { maxChars?: number } = {}
): Promise<DetailResult> {
  const maxChars = options.maxChars ?? MAX_DETAIL_CHARS;
  if (!evidence.git.isRepo) {
    return {
      file: request.file,
      text: "(cannot show a diff: this workspace is not a git repository)",
    };
  }
  const text = await readPathDiff(evidence.workspaceRoot, request.file, { maxChars: maxChars * 2 });
  // On-demand detail is the one evidence path that can carry file content, so
  // it is sanitized here rather than trusting every caller to remember.
  const safe = sanitizeOutput(text).text;
  return {
    file: request.file,
    text: `${safe.slice(0, maxChars)}${safe.length > maxChars ? "\n(diff truncated)" : ""}`,
  };
}

export { MAX_RECEIPT_SUMMARY_CHARS };
