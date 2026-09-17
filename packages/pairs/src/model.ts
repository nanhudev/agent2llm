/**
 * Pair / Context / Run — the three nouns the product is allowed to show.
 *
 * A **Pair** is one Brain adapter plus one Harness adapter plus the Brain
 * conversation they share. It is the first-class entity: a Pair outlives a
 * goal, and the same pair runs many goals through it.
 *
 * A **Context** describes where the Harness is already working. It is
 * harness-owned by default — if WorkBuddy already has `D:\projects\my-game`
 * open, asking the user to pick a folder again is a second, worse answer to a
 * question the Harness already answered.
 *
 * A **Run** is one goal sent through a Pair.
 *
 * The workspace is deliberately *not* a required field of a Pair. Relay pairs
 * get their root from the Harness; only `a2l-workspace` mode (the legacy
 * brain-hands path) resolves one itself.
 *
 * Nothing here stores credentials, file contents or diffs. `PairStore` and
 * `RunStore` enforce that on write — see `assertSecretFree` in `store.ts`.
 */
import { z } from "zod";
import { adapterRefSchema, sessionCheckpointSchema } from "@agent2llm/session";

// ---- Context ----------------------------------------------------------------

/**
 * Where a Harness is working, and who said so.
 *
 * `source` is the honest part: `harness` means the adapter read it from the
 * product itself, `a2l` means Agent2LLM resolved it (a workspace record, the
 * process cwd), `user` means the human picked it. A context that could not be
 * determined is `null` — never a guess with `confidence: 0.5` attached.
 */
export const harnessContextSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().max(120).optional(),
  /** Absolute path, when the context has one. */
  root: z.string().max(1000).optional(),
  source: z.enum(["harness", "a2l", "user"]),
  /**
   * How sure the adapter is, 0..1. Only present when the adapter can express
   * it; absent means "the adapter stated this plainly", not "0.5-ish".
   */
  confidence: z.number().min(0).max(1).optional(),
  /** Short, non-secret extras (project name, session label, ...). */
  detail: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

export type HarnessContext = z.infer<typeof harnessContextSchema>;

export const CONTEXT_MODES = ["harness-owned", "a2l-workspace", "none"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export const contextModeSchema = z.enum(CONTEXT_MODES);

// ---- Execution policy -------------------------------------------------------

/**
 * How much freedom the Harness is given.
 *
 * `execution-only` is the relay default and the product's central claim: the
 * Brain has already reasoned, so the Harness executes and nothing more. The
 * banned outputs are named explicitly because they are exactly what a coding
 * agent volunteers when it is handed a goal instead of a step — and every one
 * of them is a file the user did not ask for.
 */
export const DOCUMENTATION_POLICY = ["if-required", "never"] as const;

export const executionPolicySchema = z.object({
  mode: z.enum(["execution-only", "standard"]).default("execution-only"),
  /** Suppress unrequested plans, progress reports and summary documents. */
  cleanExecution: z.boolean().default(true),
  documentation: z.enum(DOCUMENTATION_POLICY).default("if-required"),
  /** How much verified evidence travels back to the Brain. */
  evidence: z.enum(["compact", "detailed"]).default("compact"),
  /** Let the Brain ask for a specific diff after reading the compact form. */
  evidenceDetailOnDemand: z.boolean().default(true),
});

export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = executionPolicySchema.parse({});

/** The policy the legacy workflows use, where the Brain reviews raw evidence. */
export const STANDARD_EXECUTION_POLICY: ExecutionPolicy = executionPolicySchema.parse({
  mode: "standard",
  cleanExecution: false,
  evidence: "detailed",
  evidenceDetailOnDemand: false,
});

// ---- Token accounting -------------------------------------------------------

/**
 * What a Brain actually spent, as far as it can be known.
 *
 * Provider-reported numbers are the only ones allowed to be called tokens. A
 * web Brain is subscription-metered and reports nothing, so it says
 * `unavailable` with a reason. Nothing is ever estimated into this field: that
 * is what `TextSize` in the run metrics is for, and it is labelled separately.
 */
export const brainTokenAccountingSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("provider-reported"),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    model: z.string().max(120).optional(),
  }),
  z.object({
    source: z.literal("unavailable"),
    /** Why it is unknown — "subscription-metered web Brain", "CLI prints none". */
    reason: z.string().min(1).max(200),
  }),
]);

export type BrainTokenAccounting = z.infer<typeof brainTokenAccountingSchema>;

/** Byte/conservative-estimate sizes. Never presented as billed tokens. */
export const textSizeSchema = z.object({
  bytes: z.number().int().nonnegative().default(0),
  /**
   * A crude bytes/4 estimate. Named "estimated text tokens" everywhere it is
   * shown, so it can never be mistaken for a provider's count.
   */
  estimatedTextTokens: z.number().int().nonnegative().default(0),
});

export type TextSize = z.infer<typeof textSizeSchema>;

export function measureTextSize(text: string): TextSize {
  const bytes = Buffer.byteLength(text, "utf8");
  return { bytes, estimatedTextTokens: Math.ceil(bytes / 4) };
}

// ---- Metrics ----------------------------------------------------------------

export const runMetricsSchema = z.object({
  brainTurns: z.number().int().nonnegative().default(0),
  harnessRuns: z.number().int().nonnegative().default(0),
  filesChanged: z.number().int().nonnegative().default(0),
  /** `null` means no test command reported a number — not zero. */
  testsPassed: z.number().int().nonnegative().nullable().default(null),
  revisions: z.number().int().nonnegative().default(0),
  brainTokens: brainTokenAccountingSchema.nullable().default(null),
  /** Everything Agent2LLM actually sent the Harness across the run. */
  harnessInstruction: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  harnessResponse: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  evidenceRaw: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  evidenceCompact: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  /** Sums of the per-turn values the Brain adapter reported. */
  brainPrompt: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  brainResponse: textSizeSchema.default({ bytes: 0, estimatedTextTokens: 0 }),
  elapsedMs: z.number().int().nonnegative().default(0),
});

export type RunMetrics = z.infer<typeof runMetricsSchema>;

export function emptyRunMetrics(): RunMetrics {
  return runMetricsSchema.parse({});
}

/** Adds a measured text size onto an accumulator field. */
export function addTextSize(current: TextSize, text: string): TextSize {
  const next = measureTextSize(text);
  return {
    bytes: current.bytes + next.bytes,
    estimatedTextTokens: current.estimatedTextTokens + next.estimatedTextTokens,
  };
}

// ---- Execution receipt ------------------------------------------------------

/**
 * What one execution actually did, in a form small enough to show a Brain.
 *
 * The summary is capped hard. A Harness asked to "summarise" writes an essay;
 * the Brain needs a status line and a file list, and can ask for a diff later.
 */
export const MAX_RECEIPT_SUMMARY_CHARS = 480;

export const executionReceiptSchema = z.object({
  receiptId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  iteration: z.number().int().nonnegative(),
  status: z.enum(["success", "failure", "blocked", "timeout", "unknown"]),
  exitStatus: z.string().max(120).default("unknown"),
  changedFiles: z.array(z.string().max(400)).max(400).default([]),
  tests: z.string().max(300).nullable().default(null),
  /** Parsed pass count when the test output made one readable. */
  testsPassed: z.number().int().nonnegative().nullable().default(null),
  commands: z.array(z.string().max(300)).max(40).default([]),
  errors: z.array(z.string().max(400)).max(20).default([]),
  summary: z.string().max(MAX_RECEIPT_SUMMARY_CHARS).default(""),
  durationMs: z.number().int().nonnegative().default(0),
  at: z.string().max(40),
});

export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;

// ---- Pair -------------------------------------------------------------------

export const pairSchema = z.object({
  pairId: z.string().min(1).max(64),
  brainAdapterId: z.string().min(1).max(64),
  /** The Brain's own pointer to its conversation. Opaque to the core. */
  brainRef: adapterRefSchema.nullable().default(null),
  harnessAdapterId: z.string().min(1).max(64),
  harnessRef: adapterRefSchema.nullable().default(null),
  context: harnessContextSchema.nullable().default(null),
  contextMode: contextModeSchema.default("harness-owned"),
  executionPolicy: executionPolicySchema.default(DEFAULT_EXECUTION_POLICY),
  /** Optional human label, e.g. "my-game". Shown by `a2l pair list`. */
  label: z.string().max(120).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable().default(null),
});

export type Pair = z.infer<typeof pairSchema>;

export interface CreatePairInput {
  pairId: string;
  brainAdapterId: string;
  harnessAdapterId: string;
  contextMode?: ContextMode;
  executionPolicy?: Partial<ExecutionPolicy>;
  label?: string;
}

export function createPair(input: CreatePairInput): Pair {
  const now = new Date().toISOString();
  return pairSchema.parse({
    pairId: input.pairId,
    brainAdapterId: input.brainAdapterId,
    harnessAdapterId: input.harnessAdapterId,
    contextMode: input.contextMode ?? "harness-owned",
    executionPolicy: { ...DEFAULT_EXECUTION_POLICY, ...(input.executionPolicy ?? {}) },
    label: input.label ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export function touchPair(pair: Pair): Pair {
  return { ...pair, updatedAt: new Date().toISOString() };
}

/**
 * A Pair is identified by its two adapters plus its Context.
 *
 * Two pairs may share a Harness (the same Codex install working in two repos),
 * which is why the context is part of the identity rather than the pair id.
 */
export function pairIdentity(pair: {
  brainAdapterId: string;
  harnessAdapterId: string;
  context: HarnessContext | null;
}): string {
  const contextId = pair.context?.id ?? "no-context";
  return `${pair.brainAdapterId}::${pair.harnessAdapterId}::${contextId}`;
}

// ---- Run --------------------------------------------------------------------

export const RUN_STATUSES = ["running", "done", "blocked", "error", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Bounded so a long-lived pair cannot grow a run file without limit. */
export const MAX_RECEIPTS_PER_RUN = 60;

export const runRecordSchema = z.object({
  runId: z.string().min(1).max(64),
  pairId: z.string().min(1).max(64),
  goal: z.string().min(1).max(1000),
  workflowId: z.string().min(1).max(64).default("relay"),
  context: harnessContextSchema.nullable().default(null),
  status: z.enum(RUN_STATUSES).default("running"),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  iterations: z.number().int().nonnegative().default(0),
  metrics: runMetricsSchema.default({
    brainTurns: 0,
    harnessRuns: 0,
    filesChanged: 0,
    testsPassed: null,
    revisions: 0,
    brainTokens: null,
    harnessInstruction: { bytes: 0, estimatedTextTokens: 0 },
    harnessResponse: { bytes: 0, estimatedTextTokens: 0 },
    evidenceRaw: { bytes: 0, estimatedTextTokens: 0 },
    evidenceCompact: { bytes: 0, estimatedTextTokens: 0 },
    brainPrompt: { bytes: 0, estimatedTextTokens: 0 },
    brainResponse: { bytes: 0, estimatedTextTokens: 0 },
    elapsedMs: 0,
  }),
  /** Compact receipts only. Diffs are never persisted here. */
  receipts: z.array(executionReceiptSchema).max(MAX_RECEIPTS_PER_RUN).default([]),
  checkpoint: sessionCheckpointSchema.nullable().default(null),
  /** Set when the run ended on a failure the user should see verbatim. */
  error: z.string().max(600).nullable().default(null),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

export function createRunRecord(input: {
  runId: string;
  pairId: string;
  goal: string;
  workflowId?: string;
  context?: HarnessContext | null;
}): RunRecord {
  return runRecordSchema.parse({
    runId: input.runId,
    pairId: input.pairId,
    goal: input.goal,
    workflowId: input.workflowId ?? "relay",
    context: input.context ?? null,
    startedAt: new Date().toISOString(),
  });
}
