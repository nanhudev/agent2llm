/**
 * Fallback change tracking for workspaces that are not git repositories.
 * Agent2LLM never requires `git init`: without git, a hash snapshot of the
 * workspace provides "what changed since the last iteration".
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "@agent2llm/config";
import type { Workspace } from "./manager.js";

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  hash: string | null;
}

export type Snapshot = Record<string, FileFingerprint>;

const MAX_HASH_BYTES = 1024 * 1024;

function snapshotFile(workspaceId: string): string {
  return path.join(ensureDir(path.join(getStateDir(), "snapshots")), `${workspaceId}.json`);
}

function hashFile(abs: string): string | null {
  try {
    const stat = fs.statSync(abs);
    if (stat.size > MAX_HASH_BYTES) return null;
    return createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function walk(workspace: Workspace, dirAbs: string, dirRel: string, out: Snapshot, depth = 0): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
    if (workspace.ignoreRules.isHidden(childRel)) continue;
    const childAbs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(workspace, childAbs, childRel, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(childAbs);
    } catch {
      continue;
    }
    out[childRel] = { size: stat.size, mtimeMs: Math.round(stat.mtimeMs), hash: hashFile(childAbs) };
  }
}

export function takeSnapshot(workspace: Workspace): Snapshot {
  const snapshot: Snapshot = {};
  walk(workspace, workspace.root, "", snapshot);
  return snapshot;
}

export function saveSnapshot(workspaceId: string, snapshot: Snapshot): void {
  writeSecureJson(snapshotFile(workspaceId), snapshot);
}

export function loadSnapshot(workspaceId: string): Snapshot | null {
  return readJsonIfExists<Snapshot>(snapshotFile(workspaceId));
}

export interface SnapshotDiff {
  added: string[];
  modified: string[];
  deleted: string[];
}

export function diffSnapshots(previous: Snapshot | null, current: Snapshot): SnapshotDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [file, fingerprint] of Object.entries(current)) {
    const before = previous?.[file];
    if (!before) {
      added.push(file);
      continue;
    }
    if (before.size !== fingerprint.size || before.mtimeMs !== fingerprint.mtimeMs) {
      modified.push(file);
      continue;
    }
    if (before.hash && fingerprint.hash && before.hash !== fingerprint.hash) modified.push(file);
  }
  if (previous) {
    for (const file of Object.keys(previous)) {
      if (!(file in current)) deleted.push(file);
    }
  }
  return { added, modified, deleted };
}

/** Convenience used by the execution layer for non-git workspaces. */
export function changedSinceLastSnapshot(workspace: Workspace): SnapshotDiff & { files: string[] } {
  const previous = loadSnapshot(workspace.id);
  const current = takeSnapshot(workspace);
  saveSnapshot(workspace.id, current);
  const diff = diffSnapshots(previous, current);
  return { ...diff, files: [...diff.added, ...diff.modified, ...diff.deleted] };
}
