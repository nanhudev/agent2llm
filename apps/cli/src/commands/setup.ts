/**
 * `agent2llm setup`, `pair`, `unpair`, `logs`, `version`.
 */
import fs from "node:fs";
import path from "node:path";
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { getStateDir, loadMachineConfig, patchMachineConfig, machineConfigPath } from "@agent2llm/config";
import { startBridge } from "@agent2llm/bridge";
import { createTunnelProvider } from "@agent2llm/tunnel";
import { WorkspaceRegistry } from "@agent2llm/workspace";
import { Logger } from "@agent2llm/logger";
import * as ui from "../ui.js";

export interface SetupOptions {
  brain?: string;
  harness?: string;
  workspace?: string;
  tunnel?: boolean;
}

/**
 * Setup hides MCP/OAuth/PKCE behind plain language. `--verbose` is the only
 * place technical details appear.
 */
export async function runSetup(registry: AdapterRegistry, options: SetupOptions): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace ?? process.cwd());
  const record = new WorkspaceRegistry().add(workspaceRoot);

  ui.heading("Agent2LLM setup");
  const spin = ui.spinner("Preparing workspace");
  const logger = new Logger({ name: "setup", console: false });
  const bridge = await startBridge({
    workspaceRoot,
    logger,
    persistRuntime: true,
    ...(options.tunnel ? { tunnelProvider: await createTunnelProvider("auto", logger) } : {}),
  });
  spin.succeed(`Secure connection ready on ${bridge.localBaseUrl()}`);

  for (const id of [options.brain, options.harness]) {
    if (!id) continue;
    const adapter = registry.get(id);
    if (!adapter) {
      ui.warn(`Unknown adapter '${id}'.`);
      continue;
    }
    const result = await adapter.setup({
      workspaceId: record.id,
      workspaceRoot,
      requestUserAction: ui.requestUserAction,
    });
    ui.line(
      `  ${result.ok ? ui.MARK_OK : ui.MARK_FAIL} ${adapter.metadata().name}: ${result.message ?? result.status}`
    );
  }

  const pairing = bridge.pairing.create();
  ui.line();
  ui.line(`  Pairing code: ${ui.bold(pairing.code)} ${ui.dim(`(expires ${pairing.expiresAt})`)}`);
  ui.line("  Enter this code in the Brain's MCP connector approval screen.");
  await ui.promptText("Press Enter after the Brain is connected");
  ui.ok(`Workspace ${record.name} is ready.`);
  await bridge.close();
}

export async function runPair(workspace?: string): Promise<void> {
  const root = path.resolve(workspace ?? process.cwd());
  const record = new WorkspaceRegistry().add(root);
  const bridge = await startBridge({ workspaceRoot: root, logger: new Logger({ name: "pair", console: false }) });
  const pairing = bridge.pairing.create();
  ui.line(`Workspace ${record.name}`);
  ui.line(`Pairing code: ${ui.bold(pairing.code)} ${ui.dim(`(expires ${pairing.expiresAt})`)}`);
  await ui.promptText("Press Enter when done");
  await bridge.close();
}

export async function runUnpair(workspace?: string): Promise<void> {
  const root = path.resolve(workspace ?? process.cwd());
  const bridge = await startBridge({ workspaceRoot: root, logger: new Logger({ name: "unpair", console: false }) });
  const revoked = bridge.authStore.revokeAll();
  bridge.pairing.invalidateAll();
  ui.ok(`Revoked ${revoked} token(s).`);
  await bridge.close();
}

export async function runLogs(options: { json?: boolean; lines?: number } = {}): Promise<void> {
  const dir = path.join(getStateDir(), "logs");
  if (!fs.existsSync(dir)) {
    ui.line("No logs yet.");
    return;
  }
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".log"));
  if (files.length === 0) {
    ui.line("No logs yet.");
    return;
  }
  const limit = options.lines ?? 50;
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n");
    const tail = content.slice(-limit);
    if (options.json) {
      ui.jsonOutput({ file, lines: tail });
    } else {
      ui.heading(file);
      for (const line of tail) ui.line(`  ${line}`);
    }
  }
}

export function runVersion(): void {
  ui.jsonOutput({ name: "agent2llm", version: "0.1.0", protocol: "a2l/1", node: process.version });
}

export function runConfigSet(key: string, value: string): void {
  const allowed = ["defaultBrain", "defaultHarness", "defaultWorkflow", "maxIterations", "logLevel"];
  if (!allowed.includes(key)) {
    ui.fail(`Unknown config key '${key}'. Allowed: ${allowed.join(", ")}`);
    return;
  }
  const patch: Record<string, unknown> = { [key]: key === "maxIterations" ? Number.parseInt(value, 10) : value };
  patchMachineConfig(patch);
  ui.ok(`${key} = ${value} ${ui.dim(`(${machineConfigPath()})`)}`);
  void loadMachineConfig;
}
