/**
 * The runtime shape one relay run threads through its loop.
 *
 * Split out from the runner so that the loop, the dispatch and the reply
 * interpretation can each be read on their own — the runner decides *when* to
 * speak to whom, and these are the things it speaks with.
 */
import type { EventSink } from "@agent2llm/core";
import type {
  AdapterRef,
} from "@agent2llm/session";
import type {
  HarnessAdapter,
  HarnessSession,
  UserActionRequest,
} from "@agent2llm/adapter-sdk";
import type { Logger } from "@agent2llm/logger";
import type {
  ExecutionPolicy,
  RunMetrics,
  RunRecord,
  RunStatus,
  TextSize,
} from "@agent2llm/pairs";
import type { CollectedEvidence } from "@agent2llm/evidence";
import type { ConversationBase } from "./brain-session.js";
import type { ControlChannel } from "./control-channel.js";
import type { ProtocolMachine } from "./machine.js";

export interface RelayContext {
  channel: ControlChannel;
  machine: ProtocolMachine;
  harness: HarnessAdapter;
  harnessSession: HarnessSession;
  /** The conversation labels, plus the harness id the evidence names it by. */
  base: ConversationBase & { adapterId: string };
  state: RelayState;
  policy: ExecutionPolicy;
  logger: Logger;
  emit: EventSink;
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
  signal?: AbortSignal;
}

/** Default round ceiling. A relay run that needs more than this has gone wrong. */
export const DEFAULT_MAX_ITERATIONS = 8;
/** Ceiling on the ceiling: a mistyped flag must not start a runaway loop. */
export const HARD_MAX_ITERATIONS = 25;
/**
 * How many on-demand diffs one run will fetch.
 *
 * A Brain that keeps asking is stuck, and the ceiling is what turns that into a
 * verdict instead of an endless polite conversation.
 */
export const MAX_DETAIL_REQUESTS = 12;

/**
 * The numbers and files a run accumulates, kept in one place so the loop only
 * has to say what happened.
 */
export class RelayState {
  iterations = 0;
  revisions = 0;
  detailRequests = 0;
  brainTurns = 0;
  metrics: RunMetrics;
  changed = new Set<string>();
  /** The most recent evidence, which is what a detail request is answered from. */
  evidence: CollectedEvidence | null = null;

  constructor(
    public run: RunRecord,
    public brainRef: AdapterRef | null
  ) {
    this.metrics = structuredClone(run.metrics);
  }

  /**
   * The honest status.
   *
   * A run whose evidence was *contradicted* — the Harness reported success and
   * named files while the working tree was untouched — is not reported as
   * `done` even if the Brain accepted it. The Brain decided on what it was
   * shown; the status is the record of what was there.
   */
  normalize(status: RunStatus, summary: string): { status: RunStatus; summary: string } {
    if (status !== "done" || this.evidence?.verdict !== "contradicted") return { status, summary };
    return {
      status: "blocked",
      summary: `The Brain accepted the run, but the repository contradicts the last execution: ${this.evidence.verdictReason}`,
    };
  }

  finish(status: RunStatus, summary: string): { status: RunStatus; summary: string } {
    this.metrics.harnessRuns = this.iterations;
    this.metrics.revisions = this.revisions;
    this.metrics.filesChanged = this.changed.size;
    return { status, summary: summary.slice(0, 1000) };
  }
}

export function clampIterations(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_ITERATIONS;
  return Math.min(Math.max(1, Math.floor(value)), HARD_MAX_ITERATIONS);
}

export function sumSize(current: TextSize, next: TextSize): TextSize {
  return {
    bytes: current.bytes + next.bytes,
    estimatedTextTokens: current.estimatedTextTokens + next.estimatedTextTokens,
  };
}
