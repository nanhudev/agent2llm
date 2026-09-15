/**
 * `agent2llm session …` and `agent2llm workspace …`.
 */
import path from "node:path";
import { loadMachineConfig } from "@agent2llm/config";
import { SessionStore } from "@agent2llm/session";
import { WorkspaceRegistry } from "@agent2llm/workspace";
import * as ui from "../ui.js";

export async function runSessionList(options: { json?: boolean } = {}): Promise<void> {
  const sessions = new SessionStore();
  const all = sessions.list();
  if (options.json) {
    ui.jsonOutput(all);
    return;
  }
  if (all.length === 0) {
    ui.line("No sessions yet.");
    return;
  }
  ui.heading("Sessions");
  ui.line(
    ui.renderTable(
      [
        { header: "ID", width: 26 },
        { header: "STATE", width: 12 },
        { header: "ITER", width: 5 },
        { header: "BRAIN", width: 16 },
        { header: "HARNESS", width: 16 },
        { header: "UPDATED", width: 22 },
      ],
      all.map((session) => [
        session.sessionId,
        session.protocolState,
        String(session.iteration),
        session.brainAdapterId,
        session.harnessAdapterId,
        session.updatedAt.slice(0, 19).replace("T", " "),
      ])
    )
  );
  ui.line();
}

export async function runSessionShow(id: string, options: { json?: boolean } = {}): Promise<void> {
  const session = new SessionStore().get(id);
  if (!session) {
    ui.fail(`No session with id '${id}'.`);
    return;
  }
  if (options.json) {
    ui.jsonOutput(session);
    return;
  }
  ui.heading(`Session ${session.sessionId}`);
  for (const [key, value] of Object.entries(session)) {
    ui.line(`  ${key.padEnd(18)} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  ui.line();
}

export async function runSessionStop(id: string): Promise<void> {
  const store = new SessionStore();
  const session = store.get(id);
  if (!session) {
    ui.fail(`No session with id '${id}'.`);
    return;
  }
  store.save({
    ...session,
    finishedAt: new Date().toISOString(),
    protocolState: "BLOCKED",
    updatedAt: new Date().toISOString(),
  });
  ui.ok(`Session ${id} stopped.`);
}

export async function runSessionResume(id: string): Promise<string | null> {
  const session = new SessionStore().get(id);
  if (!session) {
    ui.fail(`No session with id '${id}'.`);
    return null;
  }
  return session.sessionId;
}

export async function runWorkspaceList(options: { json?: boolean } = {}): Promise<void> {
  const registry = new WorkspaceRegistry();
  const all = registry.list();
  if (options.json) {
    ui.jsonOutput(all);
    return;
  }
  if (all.length === 0) {
    ui.line("No registered workspaces.");
    return;
  }
  ui.heading("Workspaces");
  ui.line(
    ui.renderTable(
      [
        { header: "ID", width: 14 },
        { header: "NAME", width: 24 },
        { header: "EXISTS", width: 8 },
      ],
      all.map((workspace) => [workspace.id, workspace.name, workspace.exists ? "yes" : "no"])
    )
  );
  ui.line();
}

export async function runWorkspaceAdd(root: string, name?: string): Promise<void> {
  const registry = new WorkspaceRegistry();
  const record = registry.add(path.resolve(root), name);
  ui.ok(`Registered ${record.name} (${record.id}) at ${record.root}.`);
}

export async function runWorkspaceRemove(id: string): Promise<void> {
  const registry = new WorkspaceRegistry();
  ui.line(registry.remove(id) ? `Removed workspace ${id}.` : `No workspace with id '${id}'.`);
}

export async function runConfigShow(options: { json?: boolean } = {}): Promise<void> {
  const config = loadMachineConfig();
  if (options.json) {
    ui.jsonOutput(config);
    return;
  }
  ui.heading("Configuration");
  for (const [key, value] of Object.entries(config)) {
    ui.line(`  ${key.padEnd(18)} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  ui.line();
}
