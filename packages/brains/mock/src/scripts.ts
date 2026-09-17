/**
 * What a mock Brain is told to do.
 *
 * Kept out of the adapter so `index.ts` stays a state machine inside the
 * 400-line module budget, and so the two plans read as prose: each one carries
 * the reason it exists, which is the only thing that stops a later reader from
 * collapsing them back into one.
 */
import fs from "node:fs";

export type MockScriptStep =
  | { type: "INSPECTING"; focus?: string }
  /** Relay Mode: one executable step plus how it will be judged. */
  | { type: "NEXT_ACTION"; task: string; acceptance?: string[]; files?: string[] }
  | { type: "PLAN"; actions: string[]; rationale?: string; successCriteria?: string; files?: string[] }
  | { type: "REVIEWING"; focus?: string }
  | { type: "DONE"; summary: string }
  | { type: "REVISE"; reason: string; requiredChanges: string[] }
  | { type: "BLOCKED"; reason: string; needs?: string[] };

/** The constraint the orchestrator puts on INIT to mark a Relay run. */
export const WORKFLOW_RELAY = "workflow:relay";

const STEP_TYPES = [
  "INSPECTING",
  "NEXT_ACTION",
  "PLAN",
  "REVIEWING",
  "DONE",
  "REVISE",
  "BLOCKED",
] as const;

/** The fields a step cannot do without, so a typo fails at load, not mid-run. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  NEXT_ACTION: ["task"],
  PLAN: ["actions"],
  DONE: ["summary"],
  REVISE: ["reason", "requiredChanges"],
  BLOCKED: ["reason"],
};

/**
 * A script supplied by the environment, so the real CLI can drive this Brain.
 *
 * `A2L_MOCK_BRAIN_SCRIPT=<path to a JSON array of steps>`.
 *
 * This is what makes an end-to-end acceptance run possible at all: register the
 * mock brain with `--brain mock-brain`, point the pair at a real harness, and
 * every layer above the reasoning is the shipped one — pair store, dispatch
 * brief, harness subprocess, evidence collector, receipts. Without it the mock
 * can only be driven from inside a test process, and an end-to-end run through
 * the CLI has no way to say what to do.
 *
 * A malformed script throws instead of falling back to the default. A run that
 * quietly executed a different plan than the one on disk is the worst possible
 * outcome for something whose result gets cited as evidence.
 */
export function scriptFromEnvironment(
  env: Record<string, string | undefined> = process.env
): MockScriptStep[] | undefined {
  const file = env.A2L_MOCK_BRAIN_SCRIPT;
  if (!file) return undefined;

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`A2L_MOCK_BRAIN_SCRIPT is set but ${file} could not be read: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`A2L_MOCK_BRAIN_SCRIPT: ${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`A2L_MOCK_BRAIN_SCRIPT: ${file} must be a non-empty array of steps.`);
  }
  parsed.forEach((step, index) => {
    const value = step as { type?: unknown };
    if (typeof value?.type !== "string" || !(STEP_TYPES as readonly string[]).includes(value.type)) {
      throw new Error(
        `A2L_MOCK_BRAIN_SCRIPT: step ${index} has type '${String(value?.type)}'; ` +
          `expected one of ${STEP_TYPES.join(", ")}.`
      );
    }
    for (const field of REQUIRED_FIELDS[value.type] ?? []) {
      if ((step as Record<string, unknown>)[field] === undefined) {
        throw new Error(`A2L_MOCK_BRAIN_SCRIPT: step ${index} (${value.type}) is missing '${field}'.`);
      }
    }
  });
  return parsed as MockScriptStep[];
}

/**
 * The brain-hands plan: look, plan, review, finish.
 *
 * The default when nothing says otherwise, because `agent2llm run --brain
 * mock-brain --harness mock-harness --goal smoke` is the documented no-login
 * smoke test and it is a brain-hands run.
 */
export const DEFAULT_HANDS_SCRIPT: MockScriptStep[] = [
  { type: "INSPECTING", focus: "workspace" },
  { type: "PLAN", actions: ["Implement the change", "Run the tests"], successCriteria: "Tests pass" },
  { type: "REVIEWING" },
  { type: "DONE", summary: "Task complete." },
];

/**
 * The Relay plan: one step, then a verdict.
 *
 * Without this the mock pair could not demonstrate the headline workflow at
 * all: a Relay run driven by the brain-hands plan ends `blocked` with "the
 * Brain sent PLAN where a next step or a verdict was expected", which is
 * correct behaviour and a terrible first impression.
 */
export const DEFAULT_RELAY_SCRIPT: MockScriptStep[] = [
  {
    type: "NEXT_ACTION",
    task: "Write the file that proves the loop ran, then stop.",
    acceptance: ["the harness reports the step as executed"],
  },
  { type: "DONE", summary: "Mock relay run complete." },
];
