/**
 * `agent2llm run` — interactive or fully non-interactive.
 *
 *   agent2llm run --brain chatgpt-web --harness dsh --workflow brain-hands
 *   agent2llm run --brain chatgpt-web --harness workbuddy --goal "Add dark mode"
 */
import path from "node:path";
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { loadMachineConfig } from "@agent2llm/config";
import { Logger } from "@agent2llm/logger";
import { SessionStore } from "@agent2llm/session";
import { Workspace, WorkspaceRegistry } from "@agent2llm/workspace";
import { createInProcessDataPlane } from "@agent2llm/mcp";
import { Orchestrator } from "@agent2llm/orchestrator";
import { A2LError, isA2LError, toA2LError } from "@agent2llm/core";
import { formatEventHuman } from "@agent2llm/core";
import * as ui from "../ui.js";

export interface RunOptions {
  brain?: string;
  harness?: string;
  workflow?: string;
  workspace?: string;
  goal?: string;
  session?: string;
  json?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  maxIterations?: number;
}

export async function runRun(registry: AdapterRegistry, options: RunOptions): Promise<number> {
  const config = loadMachineConfig();
  const brainId = options.brain ?? config.defaultBrain;
  const harnessId = options.harness ?? config.defaultHarness;
  if (!brainId || !harnessId) {
    ui.fail("A brain and a harness are required. Use --brain/--harness or run the interactive launcher.");
    return 2;
  }

  const workspaces = new WorkspaceRegistry();
  const record = workspaces.add(path.resolve(options.workspace ?? process.cwd()));
  const sessions = new SessionStore();
  const logger = new Logger({ name: "run", level: options.verbose ? "debug" : "info", console: false });

  const events: string[] = [];
  const orchestrator = new Orchestrator({
    registry,
    sessions,
    workspaceId: record.id,
    workspaceRoot: record.root,
    logger,
    emit: (event) => {
      events.push(formatEventHuman(event));
      if (!options.json) {
        const prefix = options.verbose ? ui.dim(`[${event.kind}] `) : "";
        ui.line(`  ${prefix}${formatEventHuman(event)}`);
      }
    },
    requestUserAction: ui.requestUserAction,
    dataPlane: createInProcessDataPlane(new Workspace(record.root, { id: record.id })),
  });

  const goal = options.goal ?? (await ui.promptText("Goal"));

  ui.heading(`Agent2LLM — ${brainId} × ${harnessId}`);
  ui.line(ui.dim(`workspace: ${record.name} (${record.root})`));
  ui.line(ui.dim(`workflow:  ${options.workflow ?? config.defaultWorkflow}`));
  ui.line();

  const spin = ui.spinner("Starting collaboration");
  try {
    const result = await orchestrator.run({
      goal,
      brainId,
      harnessId,
      ...(options.workflow ? { workflowId: options.workflow } : { workflowId: config.defaultWorkflow }),
      ...(options.session ? { sessionId: options.session } : {}),
      ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    });
    spin.succeed(result.summary);
    if (options.json) ui.jsonOutput({ ...result, events });
    // A successful dry run is a success, even though it stops at READY.
    if (options.dryRun) return 0;
    return result.state === "DONE" ? 0 : 1;
  } catch (error) {
    spin.stop();
    const normalized: A2LError = isA2LError(error) ? error : toA2LError(error);
    ui.errorOutput(normalized);
    if (options.json) ui.jsonOutput({ ok: false, error: normalized.toJSON() });
    if (options.verbose && normalized.details) ui.line(ui.dim(JSON.stringify(normalized.details, null, 2)));
    return 1;
  }
}
