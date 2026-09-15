/**
 * Pre-flight for a run: workflow resolution, capability compatibility, session
 * load-or-create, and adapter setup.
 *
 * Split out of the runtime so `run()` reads as protocol, not plumbing.
 */
import { adapterIncompatible, checkCompatibility, explainReport, getWorkflow } from "@agent2llm/core";
import type { BrainAdapter, HarnessAdapter } from "@agent2llm/adapter-sdk";
import { createSession, type CollaborationSession, type SessionStore } from "@agent2llm/session";
import { newSessionId, newTaskId } from "@agent2llm/core";
import type { Logger } from "@agent2llm/logger";
import type { RunOptions } from "./runner.js";

export interface Preflight {
  workflowId: string;
  requirement: Parameters<typeof checkCompatibility>[0]["requirement"];
}

/**
 * Refuses combinations that cannot honour the workflow instead of failing
 * halfway through an execution. Never consults a pair whitelist.
 */
export async function assertCompatible(
  input: {
    brain: BrainAdapter;
    harness: HarnessAdapter;
    brainId: string;
    harnessId: string;
    logger: Logger;
  } & Preflight
): Promise<void> {
  const report = checkCompatibility({
    brainId: input.brainId,
    brain: await input.brain.capabilities(),
    harnessId: input.harnessId,
    harness: await input.harness.capabilities(),
    workflowId: input.workflowId,
    requirement: input.requirement,
  });
  if (!report.ok) throw adapterIncompatible(explainReport(report), { details: { issues: report.issues } });
  for (const issue of report.issues) input.logger.warn(issue.message);
}

export function loadOrCreateSession(
  sessions: SessionStore,
  workspaceId: string,
  options: RunOptions,
  workflowId: string
): CollaborationSession {
  if (options.sessionId) {
    const existing = sessions.get(options.sessionId);
    if (!existing) throw adapterIncompatible(`No session found with id '${options.sessionId}'.`);
    if (options.maxIterations) existing.maxIterations = options.maxIterations;
    return existing;
  }
  return sessions.save(
    createSession({
      sessionId: newSessionId(),
      taskId: newTaskId(),
      workspaceId,
      brainAdapterId: options.brainId,
      harnessAdapterId: options.harnessId,
      goal: options.goal,
      workflowId,
      ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
    })
  );
}

export async function setupAdapter(
  adapter: BrainAdapter | HarnessAdapter,
  ctx: Parameters<BrainAdapter["setup"]>[0]
): Promise<void> {
  const result = await adapter.setup(ctx);
  if (!result.ok) {
    throw adapterIncompatible(`${adapter.metadata().name} setup failed: ${result.message ?? "unknown reason"}`, {
      details: { status: result.status },
    });
  }
}

/** Resolves the workflow id and its capability requirement, or fails loudly. */
export function resolveWorkflow(workflowId: string | undefined): Preflight {
  const id = workflowId ?? "brain-hands";
  const workflow = getWorkflow(id);
  if (!workflow) throw adapterIncompatible(`Unknown workflow '${id}'.`);
  return { workflowId: id, requirement: workflow.requirement };
}
