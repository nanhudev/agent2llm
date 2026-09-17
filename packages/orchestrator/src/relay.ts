/**
 * Relay Mode.
 *
 * The loop this replaces a habit with: a Harness handed a *goal* re-derives the
 * plan the Brain already made, reads the repository, executes, and writes a
 * document about it. The plan is duplicated reasoning and the document is a file
 * nobody asked for.
 *
 * Relay inverts the ownership:
 *
 *   - The conversation belongs to the Brain. It is held by the Pair and
 *     survives across runs, so run 3 continues the same thread and long-term
 *     planning accumulates instead of being rebuilt.
 *   - The workspace belongs to the Harness. Every dispatch is one step, and the
 *     Harness is told what to do, never what the run is for.
 *   - The evidence belongs to Agent2LLM. After each dispatch it reads the
 *     repository itself, so the Brain reasons about what happened rather than
 *     about what the Harness said happened.
 *
 * The Brain is therefore never required to hold `workspace.read`, and that is
 * the product point: a subscription chat window and a cheap execution agent can
 * be paired without either being able to do the other's job.
 *
 * This module decides *when* to speak to whom. What may be said is the
 * protocol's business (`relay-reply`), and what a round consists of is
 * `relay-execution`'s.
 */
import { encodeControlMessage, type ControlMessage } from "@agent2llm/protocol";
import { createEvent, workspaceViolation, type EventSink } from "@agent2llm/core";
import { readSessionUsage } from "@agent2llm/metrics";
import type { AdapterRef } from "@agent2llm/session";
import type { AdapterRegistry, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { Logger } from "@agent2llm/logger";
import { nullLogger } from "@agent2llm/logger";
import {
  addTextSize,
  createRunRecord,
  touchPair,
  type HarnessContext,
  type Pair,
  type PairStore,
  type RunMetrics,
  type RunStatus,
  type RunStore,
} from "@agent2llm/pairs";
import { openBrainConversation, type ConversationBase, type ConversationOutcome } from "./brain-session.js";
import { ControlChannel } from "./control-channel.js";
import { ProtocolMachine } from "./machine.js";
import { answerDetail, dispatchStep, receiveReply } from "./relay-execution.js";
import { clampIterations, RelayState, type RelayContext } from "./relay-context.js";
import { actionOf, detailRequestOf, handoffFor, terminalOf } from "./relay-reply.js";
import { setupAdapter } from "./setup.js";

export * from "./relay-context.js";
export * from "./relay-reply.js";
export * from "./relay-execution.js";

export interface RelayDeps {
  registry: AdapterRegistry;
  /** Updated with the conversation ref and `lastRunAt` after every run. */
  pairs: PairStore;
  runs: RunStore;
  logger?: Logger;
  emit?: EventSink;
  signal?: AbortSignal;
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

export interface RelayRunInput {
  pair: Pair;
  runId: string;
  goal: string;
  /**
   * Where the Harness is working, resolved before the run starts.
   *
   * Passed in rather than detected here so "we could not tell" stays a decision
   * the caller makes and can report. Relay refuses to run without a root
   * instead of falling back to the process cwd, because a run that edits the
   * wrong repository looks exactly like one that worked.
   */
  context: HarnessContext | null;
  maxIterations?: number;
}

export interface RelayRunResult {
  runId: string;
  pairId: string;
  status: RunStatus;
  iterations: number;
  summary: string;
  metrics: RunMetrics;
  /** `attached` means this run is talking to the same conversation as last time. */
  conversation: { outcome: ConversationOutcome; reused: boolean };
  brainRef: AdapterRef | null;
}

export class RelayRunner {
  private readonly logger: Logger;
  private readonly emit: EventSink;

  constructor(private readonly deps: RelayDeps) {
    this.logger = deps.logger ?? nullLogger;
    this.emit =
      deps.emit ??
      ((event) => {
        this.logger.debug(`[${event.kind}] ${event.message}`);
      });
  }

  async run(input: RelayRunInput): Promise<RelayRunResult> {
    const { pair, goal, context } = input;
    const root = context?.root;
    if (!context || !root) {
      throw workspaceViolation(
        "Relay Mode has no context to work in: the Harness did not report one and none was supplied.",
        {
          hint: "Open the project in the Harness first, or pass --workspace <dir> to choose a folder.",
          details: { pairId: pair.pairId, harness: pair.harnessAdapterId },
        }
      );
    }

    const brain = this.deps.registry.getBrain(pair.brainAdapterId);
    const harness = this.deps.registry.getHarness(pair.harnessAdapterId);
    const run = this.deps.runs.save(
      createRunRecord({ runId: input.runId, pairId: pair.pairId, goal, workflowId: "relay", context })
    );
    const startedAt = Date.now();

    const machine = new ProtocolMachine({
      // The session is the *Pair*, not the run. Relay's whole claim is that one
      // Brain conversation serves many runs, so giving each run its own session
      // id would tell the Brain the opposite — and a web Brain reading a fresh
      // SESSION header every time would treat each run as a stranger.
      sessionId: `a2ls_${pair.pairId}`,
      // The task is the run: the goal is what changes between them.
      taskId: `a2lt_${input.runId}`,
      // And the workspace is the context, because in Relay the Harness's
      // context *is* the workspace.
      workspaceId: context.id,
    });

    const base: ConversationBase & { adapterId: string } = {
      sessionId: machine.sessionId,
      taskId: machine.taskId,
      workspaceId: machine.workspaceId,
      workspaceRoot: root,
      goal,
      adapterId: pair.harnessAdapterId,
    };

    const setup = (adapterId: string) => ({
      workspaceId: machine.workspaceId,
      workspaceRoot: root,
      sessionId: machine.sessionId,
      ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
      options: { adapterId },
    });
    await setupAdapter(brain, setup(pair.brainAdapterId));
    await setupAdapter(harness, setup(pair.harnessAdapterId));

    const harnessSession = await harness.createSession({ ...base });
    this.emit(
      createEvent({
        kind: "HARNESS_CONNECTED",
        message: `${pair.harnessAdapterId} · context ${context.id} (${context.source})`,
        sessionId: machine.sessionId,
        taskId: machine.taskId,
      })
    );

    const opened = await openBrainConversation(brain, {
      base,
      ref: pair.brainRef,
      // A conversation the Brain no longer has — a closed tab, an expired web
      // session — is a normal event for a pair that lives for weeks. The new
      // thread is briefed from the pair's own record and the run continues.
      replacementBrief: handoffFor(pair),
    });
    const reused = opened.outcome === "attached";
    this.emit(
      createEvent({
        kind: "BRAIN_CONNECTED",
        message: reused
          ? `${pair.brainAdapterId} · same conversation as the previous run`
          : `${pair.brainAdapterId} · conversation ${opened.outcome}`,
        sessionId: machine.sessionId,
        taskId: machine.taskId,
      })
    );

    const state = new RelayState(run, {
      adapterId: pair.brainAdapterId,
      ref: opened.session.ref,
      savedAt: new Date().toISOString(),
    });

    // Relay records receipts against the run, not control messages against a
    // session, so the channel is given no persistence sink at all. It does
    // report what it sent, which is how `brainPrompt` is measured.
    const channel = new ControlChannel({
      brain,
      session: opened.session,
      machine,
      logger: this.logger,
      emit: this.emit,
      onSent: (message) => {
        state.metrics.brainPrompt = addTextSize(state.metrics.brainPrompt, encodeControlMessage(message));
      },
      ...(this.deps.signal ? { signal: this.deps.signal } : {}),
      ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
    });

    const relay: RelayContext = {
      channel,
      machine,
      harness,
      harnessSession,
      base,
      state,
      policy: pair.executionPolicy,
      logger: this.logger,
      emit: this.emit,
      ...(this.deps.requestUserAction ? { requestUserAction: this.deps.requestUserAction } : {}),
      ...(this.deps.signal ? { signal: this.deps.signal } : {}),
    };

    machine.force("READY");
    await channel.send("INIT", { goal, constraints: ["workflow:relay", `context:${context.source}`] }, 0);

    let status: RunStatus;
    let summary: string;
    try {
      const finished = await this.loop(relay, clampIterations(input.maxIterations));
      status = finished.status;
      summary = finished.summary;
    } catch (error) {
      status = "error";
      summary = error instanceof Error ? error.message : String(error);
      this.logger.error(`Relay run ${input.runId} failed: ${summary}`);
    }

    state.metrics.elapsedMs = Date.now() - startedAt;
    state.metrics.filesChanged = state.changed.size;
    state.metrics.brainTurns = state.brainTurns;
    state.metrics.brainTokens = this.brainTokensFor(machine.sessionId, pair);
    ({ status, summary } = state.normalize(status, summary));

    const savedRun = this.deps.runs.save({
      ...state.run,
      status,
      finishedAt: new Date().toISOString(),
      iterations: state.iterations,
      metrics: state.metrics,
      receipts: state.run.receipts,
      ...(status === "error" ? { error: summary.slice(0, 600) } : {}),
    });

    // The pair is what the next run reads: same Brain conversation, same
    // context, same policy.
    this.deps.pairs.save(
      touchPair({
        ...pair,
        brainRef: state.brainRef,
        harnessRef: {
          adapterId: harnessSession.adapterId,
          ref: harnessSession.ref,
          savedAt: new Date().toISOString(),
        },
        lastRunAt: savedRun.finishedAt ?? new Date().toISOString(),
      })
    );

    this.emit(
      createEvent({
        kind: status === "done" ? "TASK_DONE" : "TASK_BLOCKED",
        message: summary,
        sessionId: machine.sessionId,
        taskId: machine.taskId,
        iteration: state.iterations,
        data: { runId: savedRun.runId, status, reusedConversation: reused },
      })
    );

    return {
      runId: savedRun.runId,
      pairId: pair.pairId,
      status,
      iterations: state.iterations,
      summary,
      metrics: savedRun.metrics,
      conversation: { outcome: opened.outcome, reused },
      brainRef: state.brainRef,
    };
  }

  /**
   * One step at a time, until the Brain calls it done or the rounds run out.
   *
   * There is no inner re-plan and no second opinion: the Brain holds the plan
   * because it holds the conversation, which is the entire reason the
   * conversation outlives the run.
   */
  private async loop(relay: RelayContext, maxIterations: number): Promise<{ status: RunStatus; summary: string }> {
    const { state } = relay;
    let reply: ControlMessage = await receiveReply(relay);

    for (;;) {
      const end = terminalOf(reply);
      if (end) return state.finish(end.status, end.summary);

      // A Brain may spend a turn looking rather than acting. Answering costs one
      // message and buys it the file it could not judge from a line count.
      const wanted = detailRequestOf(reply);
      if (wanted) {
        reply = await answerDetail(relay, wanted);
        continue;
      }

      const action = actionOf(reply);
      if (!action) {
        return state.finish("blocked", `The Brain sent ${reply.type} where a next step or a verdict was expected.`);
      }
      if (state.iterations >= maxIterations) {
        return state.finish(
          "blocked",
          `Stopped after ${state.iterations} executions without the Brain calling the run done.`
        );
      }
      if (reply.type === "REVISE") state.revisions += 1;

      await dispatchStep(relay, action);
      reply = await receiveReply(relay);
    }
  }

  /**
   * The Brain's spend, or the reason there is no number.
   *
   * Only a Brain adapter that reads provider usage reports any — the API brain
   * does, a web Brain is subscription-metered and reports nothing. When there is
   * none, that is what is recorded. A fabricated estimate here would make every
   * later comparison meaningless, so estimates live in `brainPrompt` and
   * `brainResponse` and are labelled as text sizes.
   */
  private brainTokensFor(sessionId: string, pair: Pair): RunMetrics["brainTokens"] {
    const entries = readSessionUsage(sessionId).filter(
      (entry) => entry.promptTokens > 0 || entry.completionTokens > 0
    );
    const first = entries[0];
    if (!first) {
      return {
        source: "unavailable",
        reason: `${pair.brainAdapterId} reports no token usage (a web Brain is subscription-metered).`,
      };
    }
    return {
      source: "provider-reported",
      promptTokens: entries.reduce((total, entry) => total + entry.promptTokens, 0),
      completionTokens: entries.reduce((total, entry) => total + entry.completionTokens, 0),
      ...(first.model ? { model: first.model } : {}),
    };
  }
}

