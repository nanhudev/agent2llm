/**
 * Workspace broker model.
 *
 * One local Agent2LLM installation serves many registered workspaces.
 * A Brain never sees a filesystem path: it sees an opaque id plus a display
 * name, and every token is bound to (installation, workspace, session).
 */
import fs from "node:fs";
import path from "node:path";
import { newWorkspaceId } from "@agent2llm/core";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "@agent2llm/config";
import { Workspace, WorkspaceError } from "./manager.js";

export interface WorkspaceRecord {
  id: string;
  name: string;
  root: string;
  addedAt: string;
  lastUsedAt?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  exists: boolean;
  lastUsedAt?: string;
}

function registryFile(): string {
  return path.join(ensureDir(path.join(getStateDir(), "workspaces")), "registry.json");
}

interface RegistryFile {
  workspaces: WorkspaceRecord[];
}

export class WorkspaceRegistry {
  private records = new Map<string, WorkspaceRecord>();

  constructor(private readonly file: string = registryFile()) {
    this.load();
  }

  private load(): void {
    const data = readJsonIfExists<RegistryFile>(this.file);
    for (const record of data?.workspaces ?? []) this.records.set(record.id, record);
  }

  private save(): void {
    writeSecureJson(this.file, { workspaces: [...this.records.values()] });
  }

  /** Register a path. Idempotent: the same canonical root keeps its id. */
  add(rootInput: string, name?: string): WorkspaceRecord {
    const workspace = new Workspace(rootInput);
    for (const record of this.records.values()) {
      if (path.resolve(record.root) === workspace.root) {
        const updated: WorkspaceRecord = {
          ...record,
          ...(name ? { name } : {}),
          lastUsedAt: new Date().toISOString(),
        };
        this.records.set(record.id, updated);
        this.save();
        return updated;
      }
    }
    const record: WorkspaceRecord = {
      id: newWorkspaceId(),
      name: name ?? workspace.name,
      root: workspace.root,
      addedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    this.save();
    return record;
  }

  remove(id: string): boolean {
    const removed = this.records.delete(id);
    if (removed) this.save();
    return removed;
  }

  get(id: string): WorkspaceRecord | null {
    return this.records.get(id) ?? null;
  }

  require(id: string): WorkspaceRecord {
    const record = this.get(id);
    if (!record) {
      throw new WorkspaceError("FILE_NOT_FOUND", `No workspace registered with id '${id}'.`);
    }
    return record;
  }

  list(): WorkspaceSummary[] {
    return [...this.records.values()]
      .map((record) => ({
        id: record.id,
        name: record.name,
        exists: fs.existsSync(record.root),
        ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Resolve to a live Workspace, or throw a typed, actionable error. */
  open(id: string): Workspace {
    const record = this.require(id);
    if (!fs.existsSync(record.root)) {
      throw new WorkspaceError("FILE_NOT_FOUND", `Workspace '${record.name}' no longer exists at ${record.root}.`);
    }
    this.records.set(record.id, { ...record, lastUsedAt: new Date().toISOString() });
    this.save();
    return new Workspace(record.root, { id: record.id, name: record.name });
  }

  /** Current directory, registered on demand. */
  ensureCurrent(rootInput: string = process.cwd()): WorkspaceRecord {
    const workspace = new Workspace(rootInput);
    for (const record of this.records.values()) {
      if (path.resolve(record.root) === workspace.root) return record;
    }
    return this.add(workspace.root);
  }
}
