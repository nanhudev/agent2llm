/**
 * What the Harness is told, and — more importantly — what it is not told.
 *
 * Relay Mode's whole economy is in this file. A Harness handed a *goal* will
 * re-derive the plan the Brain already made: it reads the repository, decides
 * an approach, writes a plan, executes it, and then writes a document about
 * having done so. All of that is duplicated reasoning, and the documents are
 * files nobody asked for.
 *
 * So an `execution-only` dispatch carries one step, its acceptance criteria,
 * and a short list of things not to produce. The run's overall goal is
 * deliberately absent from the brief: the Brain holds the long-term plan, and
 * re-stating it is exactly the invitation to re-plan that this mode removes.
 *
 * `standard` mode renders what it always rendered, so the existing workflows
 * and adapters keep their behaviour byte for byte.
 */
import type { ExecutionRequest } from "@agent2llm/adapter-sdk";

/** Hard ceiling on one dispatch brief. A brief that grows is a bug. */
export const MAX_BRIEF_CHARS = 4000;

export const EXECUTION_ONLY_PREAMBLE = [
  "EXECUTION-ONLY MODE",
  "",
  "You are the execution side of a paired AI system.",
  "",
  "The Brain has already done the reasoning and planning.",
  "",
  "Your job is only to execute the assigned next step.",
  "",
  "Rules:",
  "- execute the requested change directly",
  "- do not re-plan the whole task",
  "- do not produce implementation plans",
  "- do not create progress reports",
  "- do not create summary markdown files",
  "- do not create phase reports",
  "- do not create completion reports",
  "- do not duplicate the Brain's reasoning",
  "- do not explain what you are about to do unless required",
  "- inspect only what is needed for execution",
  "- modify the real project",
  "- run relevant tests/checks",
  "- return concise execution evidence",
].join("\n");

const DOCUMENTATION_CLAUSE = {
  "if-required": "- documentation may only be created if explicitly required by the task",
  never: "- do not create or modify documentation files",
} as const;

function isExecutionOnly(task: ExecutionRequest): boolean {
  return task.executionMode === "execution-only";
}

/**
 * The brief for one dispatch.
 *
 * Only the fields that matter to *this* step are included. `filesLikelyInvolved`
 * is a hint, not a mandate, and absence of the run goal is intentional.
 */
export function renderExecutionBrief(task: ExecutionRequest): string {
  if (!isExecutionOnly(task)) return renderStandardBrief(task);

  const action = (task.nextAction ?? task.instructions[0] ?? "").trim();
  const acceptance = task.acceptance ?? [];
  const lines: string[] = [
    EXECUTION_ONLY_PREAMBLE,
    DOCUMENTATION_CLAUSE[task.documentation ?? "if-required"],
  ];

  if (task.cleanExecution !== false) {
    lines.push("- return evidence, not narrative");
  }

  lines.push("", "NEXT ACTION", "", action || "(no action was supplied; report this instead of guessing)");

  if (acceptance.length > 0) {
    lines.push("", "ACCEPTANCE", "");
    for (const criterion of acceptance) lines.push(`- ${criterion}`);
  }

  if (task.filesLikelyInvolved && task.filesLikelyInvolved.length > 0) {
    // Named as a starting point so the harness does not sweep the repository
    // looking for what the Brain already looked up.
    lines.push("", "START HERE (not an exhaustive list)", "");
    for (const file of task.filesLikelyInvolved.slice(0, 25)) lines.push(`- ${file}`);
  }

  return lines.join("\n");
}

/**
 * The pre-relay brief, kept exactly as the harnesses rendered it.
 *
 * It lives here now only so that both shapes are decided in one place; the
 * text is unchanged on purpose, because changing it would change behaviour for
 * every existing `brain-hands` user with no benefit to them.
 */
export function renderStandardBrief(task: ExecutionRequest): string {
  return [
    `Goal: ${task.goal}`,
    "",
    "Steps:",
    ...task.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
    ...(task.successCriteria ? ["", `Success criteria: ${task.successCriteria}`] : []),
  ].join("\n");
}

export interface BriefCheck {
  text: string;
  /** True when the text had to be cut to fit the ceiling. */
  truncated: boolean;
  bytes: number;
}

/**
 * Renders and enforces the ceiling.
 *
 * Truncation is reported rather than silent: a brief cut mid-sentence still
 * executes, but the Brain should be able to see that its step was too long to
 * state in one dispatch.
 */
export function buildBrief(task: ExecutionRequest, maxChars = MAX_BRIEF_CHARS): BriefCheck {
  const text = renderExecutionBrief(task);
  if (text.length <= maxChars) {
    return { text, truncated: false, bytes: Buffer.byteLength(text, "utf8") };
  }
  const cut = text.slice(0, maxChars);
  return { text: cut, truncated: true, bytes: Buffer.byteLength(cut, "utf8") };
}
