import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, removeIfExists, writeSecureJson } from "@agent2llm/config";
import { collaborationSessionSchema, type CollaborationSession } from "./model.js";

function sessionsDir(): string {
  return ensureDir(path.join(getStateDir(), "sessions"));
}

function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.json`);
}

/** Persisted, resumable sessions. Secret-free by construction. */
export class SessionStore {
  constructor(private readonly dir: string = sessionsDir()) {}

  save(session: CollaborationSession): CollaborationSession {
    const parsed = collaborationSessionSchema.parse(session);
    writeSecureJson(path.join(this.dir, `${parsed.sessionId}.json`), parsed);
    return parsed;
  }

  get(sessionId: string): CollaborationSession | null {
    const raw = readJsonIfExists<unknown>(path.join(this.dir, `${sessionId}.json`));
    if (!raw) return null;
    const parsed = collaborationSessionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  list(): CollaborationSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const sessions: CollaborationSession[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const parsed = collaborationSessionSchema.safeParse(
        readJsonIfExists<unknown>(path.join(this.dir, file))
      );
      if (parsed.success) sessions.push(parsed.data);
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  byWorkspace(workspaceId: string): CollaborationSession[] {
    return this.list().filter((session) => session.workspaceId === workspaceId);
  }

  active(): CollaborationSession[] {
    return this.list().filter((session) => session.finishedAt === null);
  }

  remove(sessionId: string): boolean {
    const file = path.join(this.dir, `${sessionId}.json`);
    const existed = fs.existsSync(file);
    removeIfExists(file);
    return existed;
  }
}

export { sessionFile };
