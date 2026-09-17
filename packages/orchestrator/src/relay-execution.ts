/**
 * One relay round: dispatch a step, then read the repository for what it did.
 *
 * The ordering is the design. The Harness runs first, and only then does
 * Agent2LLM ask what actually happened — of git, not of the Harness. A Harness
 * that reports success while the tree is untouched is recorded as contradicting
 * itself rather than relayed to the Brain as fact.
 */
import { createEvent } from "@agent2llm/core";
import { buildBrief } from "@agent2llm/execution";
import { addTextSize, MAX_RECEIPT_SUMMARY_CHARS, type TextSize } from "@agent2llm/pairs";
import {
  buildReceipt,
  collectEvidence,
  compressEvidence,
  evidenceSizes,
  renderDetail,
} from "@agent2llm/evidence";
import { encodeControlMessage, type ControlMessage } from "@agent2llm/protocol";
import type { ExecutionRequest } from "@agent2llm/adapter-sdk";
import { executeIteration } from "./execution.js";
import { MAX_DETAIL_REQUESTS, sumSize, type RelayContext } from "./relay-context.js";
import { VERDICT_STATES, type NextAction } from "./relay-reply.js";

/**
 * Runs one step and sends the Brain the verified account of it.
 *
 * The compact evidence travels *on* the execution message rather than as a
 * second message: the ids, the exit status and the file list are one
 * execution's facts, and splitting them would let a Brain reason about half a
 * step.
 */
export async function dispatchStep(context: RelayContext, action: NextAction): Promise<void> {
  const { channel, machine, harness, harnessSession, base, state, policy } = context;
  const iteration = state.iterations + 1;
  state.iterations = iteration;

  // The goal is present because the request type requires it and because the
  // standard brief prints it. An execution-only brief deliberately does not:
  // re-stating the run's goal is exactly the invitation to re-plan that Relay
  // exists to remove.
  const request: ExecutionRequest = {
    taskId: machine.taskId,
    iteration,
    goal: base.goal,
    instructions: [action.task],
    workspaceRoot: base.workspaceRoot,
    nextAction: action.task,
    acceptance: action.acceptance,
    ...(action.files.length > 0 ? { filesLikelyInvolved: action.files } : {}),
    executionMode: policy.mode,
    cleanExecution: policy.cleanExecution,
    documentation: policy.documentation,
  };

  machine.force("DISPATCHED");
  context.emit(
    createEvent({
      kind: "EXECUTION_STARTED",
      message: `iteration ${iteration}`,
      sessionId: machine.sessionId,
      taskId: machine.taskId,
      iteration,
    })
  );
  machine.force("EXECUTING");

  const outcome = await executeIteration({
    harness,
    session: harnessSession,
    adapterId: base.adapterId,
    request,
    logger: context.logger,
    ...(context.requestUserAction ? { requestUserAction: context.requestUserAction } : {}),
  });

  const receipt = buildReceipt({
    receiptId: `a2lx_${state.run.runId}_${iteration}`,
    runId: state.run.runId,
    iteration,
    result: outcome,
    maxSummaryChars: MAX_RECEIPT_SUMMARY_CHARS,
  });
  state.run.receipts = [...state.run.receipts, receipt];

  const evidence = await collectEvidence({ workspaceRoot: base.workspaceRoot, receipt });
  const compact = compressEvidence(evidence);
  state.evidence = evidence;
  for (const file of evidence.git.files) state.changed.add(file.path);
  for (const file of evidence.git.untracked) state.changed.add(file);

  recordMetrics(context, {
    // Measured with the same renderer the adapters use, so the number
    // describes the text that was sent rather than an approximation of it.
    instruction: buildBrief(request).text,
    response: [receipt.summary, receipt.tests ?? ""].join("\n"),
    sizes: evidenceSizes(evidence, compact),
    testsPassed: receipt.testsPassed,
  });

  context.emit(
    createEvent({
      kind: "EVIDENCE_COLLECTED",
      message: `${evidence.verdict}: ${evidence.verdictReason}`,
      sessionId: machine.sessionId,
      taskId: machine.taskId,
      iteration,
      data: {
        changed: state.changed.size,
        tests: receipt.testsPassed,
        verdict: evidence.verdict,
        detailRequests: state.detailRequests,
      },
    })
  );

  await channel.send(
    "EXECUTED",
    {
      result: (receipt.summary || evidence.verdictReason).slice(0, 1000),
      changedFiles: [...evidence.git.files.map((file) => file.path), ...evidence.git.untracked].slice(0, 200),
      tests: receipt.tests,
      exitStatus: receipt.exitStatus.slice(0, 60),
      commands: receipt.commands.slice(0, 20),
      evidence: compact,
    },
    iteration
  );
}

/**
 * Answers one "show me" turn from the repository, never from the Harness.
 *
 * The ceiling on how many of these a run will answer matters more than the size
 * of each: a Brain that keeps asking has lost the thread, and a bounded count
 * turns that into a verdict rather than an endless conversation.
 */
export async function answerDetail(context: RelayContext, request: string): Promise<ControlMessage> {
  const { channel, state } = context;
  const evidence = state.evidence;
  if (!evidence || state.detailRequests >= MAX_DETAIL_REQUESTS) {
    return receiveReply(context);
  }
  const rendered = await renderDetail(evidence, { file: request });
  state.detailRequests += 1;
  context.emit(
    createEvent({
      kind: "EVIDENCE_COLLECTED",
      message: `detail: ${rendered.file}`,
      sessionId: state.run.runId,
      iteration: state.iterations,
      data: { file: rendered.file, chars: rendered.text.length, request: state.detailRequests },
    })
  );
  await channel.send("EVIDENCE_DETAIL", { file: rendered.file, detail: rendered.text }, state.iterations);
  return receiveReply(context);
}

/** Counts a Brain turn and waits for one of the accepted replies. */
export async function receiveReply(context: RelayContext): Promise<ControlMessage> {
  const reply = await context.channel.receive(VERDICT_STATES);
  context.state.brainTurns += 1;
  context.state.metrics.brainResponse = addTextSize(
    context.state.metrics.brainResponse,
    encodeControlMessage(reply)
  );
  context.emit(
    createEvent({
      kind: "NEXT_ACTION_RECEIVED",
      message: reply.type,
      sessionId: context.state.run.runId,
      iteration: context.state.iterations,
      data: { type: reply.type },
    })
  );
  return reply;
}

/**
 * Records what the round cost, in the only units that are real.
 *
 * Raw and compact evidence are measured from the objects themselves, which is
 * what makes the compression ratio a measurement rather than a claim.
 */
function recordMetrics(
  context: RelayContext,
  input: {
    instruction: string;
    response: string;
    sizes: { raw: TextSize; compact: TextSize };
    testsPassed: number | null;
  }
): void {
  const { state } = context;
  state.metrics.harnessInstruction = addTextSize(state.metrics.harnessInstruction, input.instruction);
  state.metrics.harnessResponse = addTextSize(state.metrics.harnessResponse, input.response);
  state.metrics.evidenceRaw = sumSize(state.metrics.evidenceRaw, input.sizes.raw);
  state.metrics.evidenceCompact = sumSize(state.metrics.evidenceCompact, input.sizes.compact);
  state.metrics.harnessRuns = state.iterations;
  state.metrics.revisions = state.revisions;
  state.metrics.testsPassed = input.testsPassed ?? state.metrics.testsPassed;
}
