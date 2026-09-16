/**
 * The collaboration runtime.
 *
 * This is the only place that knows the *shape* of a Brain/Harness
 * conversation. It knows nothing about ChatGPT, DSH, Cursor or WorkBuddy —
 * those are capabilities behind an adapter interface.
 */
import { createControlMessage, type A2LPayload, type A2LState, type ControlMessage } from "@agent2llm/protocol";
import {
  assertAllowed,
  createEvent,
  createPolicy,
  type EventSink,
  type PermissionPolicy,
} from "@agent2llm/core";
import type {
  AdapterRegistry,
  BrainAdapter,
  BrainSession,
  HarnessAdapter,
  ReadOnlyDataPlane,
  UserActionRequest,
} from "@agent2llm/adapter-sdk";
import type { CollaborationSession, SessionStore } from "@agent2llm/session";
import { Workspace } from "@agent2llm/workspace";
import type { Logger } from "@agent2llm/logger";
import { nullLogger } from "@agent2llm/logger";
import { ProtocolMachine } from "./machine.js";
import { BrainSessionManager } from "./brain-session.js";
import { ControlChannel } from "./control-channel.js";
import { executeIteration, recordIteration, resolveChangedFiles } from "./execution.js";
import { finalizeSession, persistCheckpoint } from "./persistence.js";
import {
  assertCompatible,
  loadOrCreateSession,
  resolveWorkflow,
  setupAdapter,
} from "./setup.js";

export interface OrchestratorDeps {
  registry: AdapterRegistry;
  sessions: SessionStore;
  workspaceId: string;
  workspaceRoot: string;
  logger?: Logger;
  emit?: EventSink;
  policy?: PermissionPolicy;
  /** Ask the human for exactly one action, then continue. */
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
  /** Abort the run (Ctrl-C, session stop). */
  signal?: AbortSignal;
  /**
   * Read-only workspace surface handed to Brains that cannot reach MCP
   * themselves (for example an API Brain). Optional by design.
   */
  dataPlane?: ReadOnlyDataPlane;
}

export interface RunOptions {
  goal: string;
  brainId: string;
  harnessId: string;
  workflowId?: string;
  sessionId?: string;
  maxIterations?: number;
  /** Resolve adapter setup without contacting any external product. */
  dryRun?: boolean;
  /**
   * Proceed even when an adapter *measured* that it is not authenticated.
   * Distinct from the unknown case, which already warns its way through: this
   * is for a user who knows better than the measurement.
   */
  ignoreAuth?: boolean;
}

export interface RunResult {
  sessionId: string;
  taskId: string;
  state: A2LState;
  iterations: number;
  summary: string;
}

const REVIEW_OUTCOMES: readonly A2LState[] = ["DONE", "REVISE", "BLOCKED", "ERROR", "HANDOFF"];

export class Orchestrator {
  private readonly logger: Logger;
  private readonly emit: EventSink;
  private readonly policy: PermissionPolicy;
  private readonly workspace: Workspace;
  private readonly brains: BrainSessionManager;

  constructor(private readonly deps: OrchestratorDeps) {
    this.logger = deps.logger ?? nullLogger;
    this.emit =
      deps.emit ??
      ((event) => {
        this.logger.debug(`[${event.kind}] ${event.message}`);
      });
    this.policy = createPolicy(deps.policy);
    this.workspace = new Workspace(deps.workspaceRoot, { id: deps.workspaceId });
    this.brains = new BrainSessionManager({
      sessions: deps.sessions,
      workspaceId: deps.workspaceId,
      workspaceRoot: deps.workspaceRoot,
      emit: this.emit,
    });
  }

  async run(options: RunOptions): Promise<RunResult> {
    const brain = this.deps.registry.getBrain(options.brainId);
    const harness = this.deps.registry.getHarness(options.harnessId);
    const { workflowId, requirement } = resolveWorkflow(options.workflowId);

    // A Brain that cannot reach MCP itself still has to be able to review, so
    // the read-only surface is offered before capabilities are read.
    this.offerDataPlane(brain);

    // The Brain must be able to inspect the workspace, otherwise "independent
    // review" would be theatre. Enforced by code, not by configuration.
    assertAllowed(this.policy, "brain", "workspace.read");
    await assertCompatible({
      brain,
      harness,
      brainId: options.brainId,
      harnessId: options.harnessId,
      logger: this.logger,
      workflowId,
      requirement,
      ...(options.dryRun || options.ignoreAuth ? { ignoreAuth: true } : {}),
    });

    const session = loadOrCreateSession(this.deps.sessions, this.deps.workspaceId, options, workflowId);
    const machine = new ProtocolMachine({
      sessionId: session.sessionId,
      taskId: session.taskId,
      workspaceId: this.deps.workspaceId,
    });

    this.emit(
      createEvent({
        kind: session.iteration > 0 ? "SESSION_RESUMED" : "SESSION_CREATED",
        message: `${session.sessionId} (${options.brainId} x ${options.harnessId})`,
        sessionId: session.sessionId,
        taskId: session.taskId,
      })
    );

    if (options.dryRun) {
      return {
        sessionId: session.sessionId,
        taskId: session.taskId,
        state: "READY",
        iterations: session.iteration,
        summary: `Dry run: ${options.brainId} x ${options.harnessId} via '${workflowId}' is compatible and ready.`,
      };
    }

    machine.force("READY");

    const setupContext = (adapterId: string) => ({
      workspaceId: this.deps.workspaceId,
      workspaceRoot: this.deps.workspaceRoot,
      sessionId: session.sessionId,
      ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
      options: { adapterId },
    });

    await setupAdapter(brain, setupContext(options.brainId));
    await setupAdapter(harness, setupContext(options.harnessId));

    const harnessSession = await harness.createSession({
      sessionId: session.sessionId,
      taskId: session.taskId,
      workspaceId: this.deps.workspaceId,
      workspaceRoot: this.deps.workspaceRoot,
      goal: session.goal,
    });
    this.emit(createEvent({ kind: "HARNESS_CONNECTED", message: options.harnessId, sessionId: session.sessionId }));

    const brainSession = await this.brains.open(brain, session);
    this.emit(createEvent({ kind: "BRAIN_CONNECTED", message: options.brainId, sessionId: session.sessionId }));

    const channel = new ControlChannel({
      brain,
      session: brainSession,
      machine,
      sessions: this.deps.sessions,
      logger: this.logger,
      emit: this.emit,
      ...(this.deps.signal ? { signal: this.deps.signal } : {}),
      ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
    });

    return this.loop({
      channel,
      machine,
      session,
      brain,
      brainSession,
      harness,
      harnessSession,
      harnessId: options.harnessId,
      workflowId,
    });
  }

  // ---- phases ----------------------------------------------------------------

  private offerDataPlane(brain: BrainAdapter): void {
    if (!this.deps.dataPlane) return;
    const candidate = brain as BrainAdapter & { attachDataPlane?: (dp: ReadOnlyDataPlane) => void };
    candidate.attachDataPlane?.(this.deps.dataPlane);
  }

  private async loop(input: {
    channel: ControlChannel;
    machine: ProtocolMachine;
    session: CollaborationSession;
    brain: BrainAdapter;
    brainSession: BrainSession;
    harness: HarnessAdapter;
    harnessSession: Parameters<HarnessAdapter["execute"]>[0];
    harnessId: string;
    workflowId: string;
  }): Promise<RunResult> {
    const { channel, machine, session, brain, harness, harnessSession, harnessId, workflowId } = input;
    let brainSession = input.brainSession;

    // READY -> INIT is driven by the control message itself, so the machine
    // validates it like any other transition.
    await channel.send("INIT", { goal: session.goal, constraints: [`workflow:${workflowId}`] }, machine.currentIteration);

    let pending = await channel.receive(["INSPECTING", "PLAN", "BLOCKED", "ERROR"]);
    if (pending.type === "INSPECTING") {
      this.logger.info("Brain is inspecting the workspace through the data plane");
      pending = await channel.receive(["PLAN", "BLOCKED", "ERROR"]);
    }
    if (pending.type === "BLOCKED" || pending.type === "ERROR") {
      return this.finish(session, machine, pending);
    }

    const plan = pending.payload as unknown as A2LPayload["PLAN"];
    let instructions = plan.actions;
    let successCriteria = plan.successCriteria;
    let files = plan.filesLikelyInvolved ?? [];
    this.emit(
      createEvent({
        kind: "PLAN_RECEIVED",
        message: `${instructions.length} actions`,
        sessionId: session.sessionId,
        taskId: session.taskId,
      })
    );

    for (let round = 0; round < session.maxIterations; round++) {
      const iteration = session.iteration + 1;

      machine.force("DISPATCHED");
      this.emit(
        createEvent({
          kind: "EXECUTION_STARTED",
          message: `iteration ${iteration}`,
          sessionId: session.sessionId,
          taskId: session.taskId,
          iteration,
        })
      );
      machine.force("EXECUTING");

      const outcome = await executeIteration({
        harness,
        session: harnessSession,
        adapterId: harnessId,
        workspaceId: this.deps.workspaceId,
        workspaceRoot: this.deps.workspaceRoot,
        taskId: session.taskId,
        iteration,
        goal: session.goal,
        instructions,
        ...(successCriteria ? { successCriteria } : {}),
        ...(files.length > 0 ? { filesLikelyInvolved: files } : {}),
        logger: this.logger,
        ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
      });

      const changedFiles = resolveChangedFiles(this.workspace, outcome);
      recordIteration(
        this.deps.workspaceId,
        { taskId: session.taskId, iteration, adapterId: harnessId },
        outcome,
        changedFiles
      );

      this.emit(
        createEvent({
          kind: "EXECUTION_COMPLETED",
          message: outcome.summary || outcome.exitStatus,
          sessionId: session.sessionId,
          taskId: session.taskId,
          iteration,
          data: { ok: outcome.ok },
        })
      );

      await channel.send(
        "EXECUTED",
        {
          result: outcome.summary.slice(0, 1000) || outcome.exitStatus,
          changedFiles: typeof changedFiles === "number" ? changedFiles : changedFiles.slice(0, 200),
          tests: outcome.tests ?? null,
          exitStatus: outcome.exitStatus.slice(0, 60),
          commands: outcome.commands.slice(0, 20),
        },
        iteration
      );

      let verdict = await channel.receive(["REVIEWING", ...REVIEW_OUTCOMES]);
      if (verdict.type === "REVIEWING") {
        this.emit(
          createEvent({
            kind: "REVIEW_STARTED",
            message: "Brain is reviewing the actual workspace state",
            sessionId: session.sessionId,
            taskId: session.taskId,
            iteration,
          })
        );
        verdict = await channel.receive([...REVIEW_OUTCOMES]);
      }

      if (verdict.type === "DONE" || verdict.type === "BLOCKED" || verdict.type === "ERROR") {
        session.iteration = iteration;
        return this.finish(session, machine, verdict);
      }

      if (verdict.type === "HANDOFF") {
        session.iteration = iteration;
        brainSession = await this.brains.handoff(brain, session, brainSession);
        continue;
      }

      const revise = verdict.payload as unknown as A2LPayload["REVISE"];
      session.iteration = iteration;
      machine.bump();
      this.emit(
        createEvent({
          kind: "REVISION_REQUESTED",
          message: revise.reason,
          sessionId: session.sessionId,
          taskId: session.taskId,
          iteration,
        })
      );
      instructions = revise.requiredChanges;
      successCriteria = revise.reason;
      files = [];
      persistCheckpoint(this.deps.sessions, session, machine.current, revise.reason, `Apply revision ${iteration}`);
    }

    session.iteration += 1;
    return this.finish(session, machine, {
      ...createControlMessage(
        "BLOCKED",
        { reason: `Stopped after ${session.maxIterations} iterations without completion.`, needs: [] },
        {
          sessionId: session.sessionId,
          taskId: session.taskId,
          workspaceId: this.deps.workspaceId,
          iteration: session.iteration,
          sender: { role: "core", adapter: "core" },
        }
      ),
    });
  }

  // ---- helpers ---------------------------------------------------------------

  private finish(session: CollaborationSession, machine: ProtocolMachine, message: ControlMessage): RunResult {
    const summary = finalizeSession(this.deps.sessions, session, message);
    this.emit(
      createEvent({
        kind: message.type === "DONE" ? "TASK_DONE" : "TASK_BLOCKED",
        message: summary,
        sessionId: session.sessionId,
        taskId: session.taskId,
        iteration: session.iteration,
      })
    );
    return {
      sessionId: session.sessionId,
      taskId: session.taskId,
      state: machine.current,
      iterations: session.iteration,
      summary,
    };
  }
}
