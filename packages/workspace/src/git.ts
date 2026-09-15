/**
 * Git inspection for the Brain data plane.
 *
 * Rewritten for Agent2LLM (C2C's git.ts was the reference for the security
 * properties only): diffs honour the sensitive-file policy via git pathspec
 * excludes, and every command is a bounded, non-mutating read.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { IgnoreRules } from "./ignore.js";

export interface GitIdentity {
  isRepo: boolean;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
}

export interface GitChange {
  path: string;
  change: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitChange[];
  unstaged: GitChange[];
  untracked: string[];
  conflicted: string[];
  hidden: { changes: number; conflicts: number };
}

export type DiffMode = "unstaged" | "staged" | "head";

export interface GitDiffPage {
  isRepo: boolean;
  mode: DiffMode;
  totalBytes: number;
  offset: number;
  returnedBytes: number;
  hasMore: boolean;
  nextOffset: number | null;
  diff: string;
}

function run(root: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { ok: false, stdout: "" };
  return { ok: true, stdout: result.stdout ?? "" };
}

export function isRepo(root: string): boolean {
  return run(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

export function gitInfo(root: string): GitIdentity {
  if (!isRepo(root)) return { isRepo: false, branch: null, commit: null, dirty: false };
  const branch = run(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() || null;
  const commit = run(root, ["rev-parse", "HEAD"]).stdout.trim() || null;
  const porcelain = run(root, ["status", "--porcelain"]).stdout.trim();
  return { isRepo: true, branch, commit, dirty: porcelain !== "" };
}

const STATUS_CODE: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  "?": "untracked",
};

export function gitStatus(workspace: { root: string; ignoreRules: IgnoreRules }): GitStatus {
  const root = workspace.root;
  if (!isRepo(root)) {
    return {
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      hidden: { changes: 0, conflicts: 0 },
    };
  }

  let hiddenChanges = 0;
  let hiddenConflicts = 0;
  const staged: GitChange[] = [];
  const unstaged: GitChange[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];

  const output = run(root, ["status", "--porcelain", "-z"]).stdout;
  const records = output.split("\0").filter((entry) => entry !== "");
  let index = 0;
  while (index < records.length) {
    const record = records[index]!;
    index++;
    if (record.length < 4) continue;
    const x = record[0]!;
    const y = record[1]!;
    let file = record.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const renamed = records[index];
      if (renamed !== undefined) {
        index++;
        file = renamed;
      }
    }
    const rel = file.split(path.sep).join("/");
    if (workspace.ignoreRules.isSensitive(rel) || workspace.ignoreRules.isNoise(rel)) {
      hiddenChanges++;
      if (x === "U" || y === "U") hiddenConflicts++;
      continue;
    }
    if (x === "?" && y === "?") {
      untracked.push(rel);
      continue;
    }
    if (x === "U" || y === "U") conflicted.push(rel);
    if (x !== " " && x !== "?") staged.push({ path: rel, change: STATUS_CODE[x] ?? x });
    if (y !== " ") unstaged.push({ path: rel, change: STATUS_CODE[y] ?? y });
  }

  const upstream = run(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]).stdout.trim() || null;
  const counts = run(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).stdout.trim();
  const [aheadRaw, behindRaw] = counts.split(/\s+/);
  return {
    isRepo: true,
    branch: gitInfo(root).branch,
    upstream,
    ahead: Number(aheadRaw ?? 0) || 0,
    behind: Number(behindRaw ?? 0) || 0,
    staged,
    unstaged,
    untracked,
    conflicted,
    hidden: { changes: hiddenChanges, conflicts: hiddenConflicts },
  };
}

const MODE_ARGS: Record<DiffMode, string[]> = {
  unstaged: [],
  staged: ["--cached"],
  head: ["HEAD"],
};

export function gitDiff(
  workspace: { root: string; ignoreRules: IgnoreRules },
  opts: { mode?: DiffMode; offset?: number; maxBytes?: number } = {},
  relPath?: string
): GitDiffPage {
  const mode: DiffMode = opts.mode ?? "unstaged";
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const maxBytes = Math.min(262144, Math.max(1024, Math.floor(opts.maxBytes ?? 65536)));
  const root = workspace.root;

  if (!isRepo(root)) {
    return {
      isRepo: false,
      mode,
      totalBytes: 0,
      offset: 0,
      returnedBytes: 0,
      hasMore: false,
      nextOffset: null,
      diff: "",
    };
  }

  const excludes = workspace.ignoreRules.gitPathspecExcludes();
  const args = ["diff", "--no-color", "--no-ext-diff", ...MODE_ARGS[mode], "--"];
  if (relPath) {
    args.push(relPath);
  } else {
    args.push(".", ...excludes);
  }
  const full = run(root, args).stdout;
  const totalBytes = Buffer.byteLength(full, "utf8");
  const slice = full.slice(offset, offset + maxBytes);
  const nextOffset = offset + Buffer.byteLength(slice, "utf8");
  return {
    isRepo: true,
    mode,
    totalBytes,
    offset,
    returnedBytes: Buffer.byteLength(slice, "utf8"),
    hasMore: nextOffset < totalBytes,
    nextOffset: nextOffset < totalBytes ? nextOffset : null,
    diff: slice,
  };
}
