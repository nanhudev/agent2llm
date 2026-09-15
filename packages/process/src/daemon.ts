/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
/**
 * Bridge process lifecycle — ADAPTED from codex-with-chatgpt (MIT),
 *   upstream: src/process/daemon.ts
 * Changes: workspace-id keyed runtime files, health-gated reuse, graceful
 * shutdown with timeout escalation, Agent2LLM naming.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  clearRuntimeState,
  findBridgeObservation,
  listRuntimeStates,
  readRuntimeState,
  type RuntimeState,
} from "@agent2llm/bridge";
import { timeoutError } from "@agent2llm/core";

export interface DaemonStopOptions {
  timeoutMs?: number;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Remove runtime files whose process is gone. `agent2llm` restarts often
 * (new session, new terminal) and stale runtime files are the classic cause
 * of "the bridge says it is running but nothing answers".
 */
export function cleanupStaleRuntime(): string[] {
  const removed: string[] = [];
  for (const state of listRuntimeStates()) {
    if (!pidAlive(state.pid)) {
      clearRuntimeState(state.workspaceId);
      removed.push(state.workspaceId);
    }
  }
  return removed;
}

/** Prefer a free port: probe first, fall back to an ephemeral port. */
export async function pickPort(preferred: number, host = "127.0.0.1"): Promise<number> {
  const net = await import("node:net");
  const free = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, host);
    });
  if (await free(preferred)) return preferred;
  return 0;
}

export interface SpawnBridgeOptions {
  workspaceRoot: string;
  workspaceId: string;
  port?: number;
  host?: string;
  entrypoint: string;
  extraArgs?: readonly string[];
  env?: Record<string, string | undefined>;
  logFile?: string;
}

/** Spawn a detached bridge process. Returns once the child is spawned. */
export function spawnBridge(options: SpawnBridgeOptions): { pid: number; logFile: string } {
  const logFile =
    options.logFile ??
    path.join(
      ((): string => {
        const dir = path.join(options.workspaceRoot, ".agent2llm");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })(),
      "bridge.log"
    );
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [options.entrypoint, "bridge", "--workspace", options.workspaceRoot], {
    cwd: options.workspaceRoot,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      AGENT2LLM_BRIDGE_PORT: String(options.port ?? 0),
      AGENT2LLM_BRIDGE_HOST: options.host ?? "127.0.0.1",
    },
  });
  child.unref();
  return { pid: child.pid ?? 0, logFile };
}

/** Wait until the bridge answers /health with the expected workspace id. */
export async function waitForHealthy(
  workspaceId: string,
  timeoutMs = 20_000
): Promise<RuntimeState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observation = await findBridgeObservation(workspaceId);
    if (observation.state === "healthy") return observation.runtime;
    if (Date.now() > deadline) {
      const detail = (observation as { reason?: string; state: string }).reason ?? "unreachable";
      throw timeoutError(
        `Bridge for workspace ${workspaceId} did not become healthy within ${timeoutMs}ms (${detail}).`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function stopBridge(workspaceId: string, options: DaemonStopOptions = {}): Promise<boolean> {
  const runtime = readRuntimeState(workspaceId);
  if (!runtime) return false;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!pidAlive(runtime.pid)) {
    clearRuntimeState(workspaceId);
    return false;
  }
  try {
    process.kill(runtime.pid, "SIGTERM");
  } catch {
    clearRuntimeState(workspaceId);
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(runtime.pid)) {
      clearRuntimeState(workspaceId);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    process.kill(runtime.pid, "SIGKILL");
  } catch {
    // already gone
  }
  clearRuntimeState(workspaceId);
  return true;
}
