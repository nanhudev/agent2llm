/**
 * Where Codex last worked.
 *
 * A Harness that already has a project open has already answered "which
 * folder?", and asking the user again is the bug Relay Mode exists to remove.
 * Codex answers it in its own files: every session gets a rollout under
 * `$CODEX_HOME/sessions/YYYY/MM/DD/`, whose first record is a `session_meta`
 * carrying the `cwd` the session ran in. That is the product's own statement
 * about a directory it worked in — not a guess about intent.
 *
 * Two rules this file enforces, both of which exist because the obvious
 * implementation gives a confident wrong answer:
 *
 * 1. **A Codex-managed workspace is not the user's project.** Codex Desktop
 *    runs each task inside its own scratch tree (`~/Documents/Codex/<date>/…`
 *    and `$CODEX_HOME/.chatgpt-projects/…`). Those paths are genuine, recent,
 *    and parse perfectly — and a relay run pointed at one would edit Codex's
 *    copy while reporting success.
 * 2. **A directory that no longer exists is not a context.** Rollouts outlive
 *    the folders they mention.
 *
 * Both rules produce `null` with a `note`, never a plausible-looking path. The
 * note matters as much as the answer: "Codex's newest session ran in Codex's
 * own workspace" and "Codex has never run here" call for different reactions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The first line of a rollout is small; this bounds a pathological one. */
const MAX_META_BYTES = 1024 * 1024;

/**
 * How many rollouts to open before giving up.
 *
 * Newest-first, so this is a cap on how far back a rejected candidate is
 * skipped — e.g. a month of Codex Desktop sessions before reaching the last
 * real project. Twenty is enough for that and cheap: it is file header reads.
 */
const DEFAULT_SCAN_LIMIT = 20;

/**
 * How old a session may be before its folder stops being a sensible default.
 *
 * A month is deliberately generous and deliberately finite: the newest rollout
 * from months ago describes a project the user may have deleted or finished,
 * and a run that edits the wrong repository looks exactly like one that worked.
 */
const DEFAULT_MAX_AGE_DAYS = 30;

export interface ActiveContextScan {
  /** The directory to use, or `null` when nothing usable was found. */
  root: string | null;
  /** When the session that named it ran (ISO). */
  at?: string;
  /** Codex's own label for that session: `codex_exec`, `codex_work_desktop`, … */
  originator?: string;
  /** How many rollouts were opened before this answer was reached. */
  scanned: number;
  /** Always populated for a `null` root: which rule rejected what. */
  note: string;
}

export interface ScanOptions {
  /** `$CODEX_HOME`, or the default `~/.codex`. */
  codexHome?: string;
  /** The user's home directory, used to recognise `~/Documents/Codex`. */
  home?: string;
  exists?: (candidate: string) => boolean;
  limit?: number;
  maxAgeDays?: number;
  now?: number;
}

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

/** True when `child` is inside `parent` (and not `parent` itself). */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Roots Codex creates for itself.
 *
 * Measured, not assumed: of the 60 most recent rollouts on this machine, 34 ran
 * under `~/Documents/Codex/<date>/<task>` or `$CODEX_HOME/.chatgpt-projects/`,
 * and none of those directories is a repository the user chose.
 */
export function codexManagedRoots(input: { codexHome: string; home: string }): string[] {
  return [path.join(input.codexHome, ".chatgpt-projects"), path.join(input.home, "Documents", "Codex")];
}

/** Every rollout file under `sessions/`, newest last (the path sorts by time). */
function rolloutFiles(codexHome: string): string[] {
  const root = path.join(codexHome, "sessions");
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(root);
  // `sessions/2026/09/17/rollout-2026-09-17T01-23-00-<uuid>.jsonl` sorts
  // chronologically as text: fixed-width date parts, then a zero-padded stamp.
  return found.sort();
}

function firstLine(file: string): string | null {
  let handle: number | null = null;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(MAX_META_BYTES);
    const read = fs.readSync(handle, buffer, 0, MAX_META_BYTES, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const end = text.indexOf("\n");
    if (end === -1) return text.length >= MAX_META_BYTES ? null : text;
    return text.slice(0, end);
  } catch {
    return null;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}

interface SessionMeta {
  cwd: string;
  at: string;
  originator: string;
}

/** The `session_meta` header, or `null` if this rollout does not carry one. */
function sessionMeta(file: string): SessionMeta | null {
  const line = firstLine(file);
  if (line === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { type?: unknown; payload?: unknown; timestamp?: unknown };
  if (record.type !== "session_meta") return null;
  const payload = record.payload as Record<string, unknown> | undefined;
  const cwd = payload?.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") return null;
  // Real rollouts carry the timestamp twice — at the top level and inside the
  // payload, a millisecond apart. Either is fine; a session with neither is
  // still usable, it just cannot be aged out.
  const at = [payload?.timestamp, record.timestamp].find((value): value is string => typeof value === "string");
  return {
    cwd,
    at: at ?? "",
    originator: typeof payload?.originator === "string" ? payload.originator : "unknown",
  };
}

/**
 * The newest directory Codex worked in that is worth offering as a context.
 *
 * Never returns a path it could not verify: the newest candidate must exist,
 * must not be a Codex-managed root, and must not be older than `maxAgeDays`.
 */
export function readLatestCodexContext(options: ScanOptions = {}): ActiveContextScan {
  const codexHome = options.codexHome ?? defaultCodexHome();
  const home = options.home ?? os.homedir();
  const exists = options.exists ?? ((candidate: string) => fs.existsSync(candidate));
  const limit = options.limit ?? DEFAULT_SCAN_LIMIT;
  const maxAgeMs = (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const now = options.now ?? Date.now();

  const files = rolloutFiles(codexHome);
  if (files.length === 0) {
    return { root: null, scanned: 0, note: `Codex has no recorded sessions under ${path.join(codexHome, "sessions")}.` };
  }

  const managed = codexManagedRoots({ codexHome, home });
  const newest = files.slice(-limit).reverse();
  let scanned = 0;
  let firstRejection = "";

  for (const file of newest) {
    const meta = sessionMeta(file);
    if (!meta) continue;
    scanned++;

    if (managed.some((root) => isInside(meta.cwd, root) || path.resolve(meta.cwd) === path.resolve(root))) {
      firstRejection ||= `Codex's most recent session ran in Codex's own workspace (${meta.cwd}), which is not a project of yours.`;
      continue;
    }
    if (!exists(meta.cwd)) {
      firstRejection ||= `Codex's most recent session worked in ${meta.cwd}, which is no longer there.`;
      continue;
    }
    const age = meta.at ? now - Date.parse(meta.at) : 0;
    if (meta.at && Number.isFinite(age) && age > maxAgeMs) {
      firstRejection ||= `Codex's most recent session worked in ${meta.cwd}, ${Math.round(age / 86400000)} days ago.`;
      continue;
    }
    return {
      root: meta.cwd,
      at: meta.at,
      originator: meta.originator,
      scanned,
      note: `Codex last worked in ${meta.cwd} (${meta.at || "time not recorded"}, ${meta.originator}).`,
    };
  }

  return {
    root: null,
    scanned,
    note:
      firstRejection ||
      `None of Codex's ${Math.min(limit, files.length)} most recent sessions recorded a usable folder.`,
  };
}
