import type { CapabilityRequirement } from "@agent2llm/protocol";

/**
 * Workflow model.
 *
 * A workflow is data, not code: it declares which capabilities the Brain and
 * the Harness must provide, and how the review loop behaves. The orchestrator
 * interprets it, so adding a workflow never touches Core internals.
 */
export const WORKFLOW_IDS = [
  "brain-hands",
  "peer",
  "planner-only",
  "review-only",
  "harness-autonomous",
  "custom",
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export function isWorkflowId(value: unknown): value is WorkflowId {
  return typeof value === "string" && (WORKFLOW_IDS as readonly string[]).includes(value);
}

export type WorkflowStep =
  | "init"
  | "inspect"
  | "plan"
  | "dispatch"
  | "execute"
  | "review"
  | "revise"
  | "done";

export interface ReviewPolicy {
  enabled: boolean;
  /**
   * `independent` — the Brain must inspect the real workspace through the
   *   data plane before deciding. This is the default and the point of the
   *   whole system.
   * `advisory` — the Brain comments but the run finishes on the first pass.
   */
  mode: "independent" | "advisory";
  maxRevisions: number;
}

export interface WorkflowDefinition {
  id: WorkflowId;
  name: string;
  description: string;
  requirement: CapabilityRequirement;
  review: ReviewPolicy;
  revision: { enabled: boolean };
  handoff: { enabled: boolean };
  /** Brain is not consulted at all when true (`harness-autonomous`). */
  brainless: boolean;
  steps: readonly WorkflowStep[];
  experimental?: boolean;
}

/**
 * What every Brain-driven workflow needs. Note `workspace.read`, not
 * `mcp.remote`: the transport is an adapter detail, the invariant is that the
 * Brain must be able to see the real workspace. An API Brain with no bridge
 * declares `workspace.read: false` and is correctly rejected.
 */
const BRAIN_CORE = [
  "session.create",
  "conversation.send",
  "conversation.receive",
  "plan.generate",
  "review.perform",
  "workspace.read",
] as const;

const HARNESS_CORE = [
  "session.create",
  "task.execute",
  "workspace.write",
  "shell.execute",
  "git.inspect",
] as const;

export function defineWorkflow(
  definition: WorkflowDefinition
): WorkflowDefinition {
  return definition;
}

export const BUILTIN_WORKFLOWS: Readonly<Record<WorkflowId, WorkflowDefinition>> = {
  "brain-hands": {
    id: "brain-hands",
    name: "Brain / Hands",
    description:
      "The Brain inspects, plans and independently reviews; the Harness executes.",
    requirement: { brain: [...BRAIN_CORE], harness: [...HARNESS_CORE] },
    review: { enabled: true, mode: "independent", maxRevisions: 8 },
    revision: { enabled: true },
    handoff: { enabled: true },
    brainless: false,
    steps: ["init", "inspect", "plan", "dispatch", "execute", "review", "revise", "done"],
  },
  peer: {
    id: "peer",
    name: "Peer",
    description:
      "Brain and Harness both propose and challenge, but only the Harness mutates the workspace.",
    requirement: { brain: [...BRAIN_CORE], harness: [...HARNESS_CORE, "stream.events"] },
    review: { enabled: true, mode: "independent", maxRevisions: 12 },
    revision: { enabled: true },
    handoff: { enabled: true },
    brainless: false,
    steps: ["init", "inspect", "plan", "dispatch", "execute", "review", "revise", "done"],
  },
  "planner-only": {
    id: "planner-only",
    name: "Planner only",
    description: "The Brain produces the plan; the Harness executes once and the run ends.",
    requirement: {
      brain: ["session.create", "conversation.send", "conversation.receive", "plan.generate", "workspace.read"],
      harness: [...HARNESS_CORE],
    },
    review: { enabled: false, mode: "advisory", maxRevisions: 0 },
    revision: { enabled: false },
    handoff: { enabled: true },
    brainless: false,
    steps: ["init", "inspect", "plan", "dispatch", "execute", "done"],
  },
  "review-only": {
    id: "review-only",
    name: "Review only",
    description: "The Harness works autonomously; the Brain reviews at the end.",
    requirement: {
      brain: ["session.create", "conversation.send", "conversation.receive", "review.perform", "workspace.read"],
      harness: [...HARNESS_CORE],
    },
    review: { enabled: true, mode: "independent", maxRevisions: 1 },
    revision: { enabled: true },
    handoff: { enabled: true },
    brainless: false,
    steps: ["init", "dispatch", "execute", "review", "revise", "done"],
  },
  "harness-autonomous": {
    id: "harness-autonomous",
    name: "Harness autonomous",
    description: "No Brain at all: Agent2LLM degrades to a unified harness launcher.",
    requirement: { brain: [], harness: ["task.execute"] },
    review: { enabled: false, mode: "advisory", maxRevisions: 0 },
    revision: { enabled: false },
    handoff: { enabled: false },
    brainless: true,
    steps: ["dispatch", "execute", "done"],
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "User-supplied workflow definition loaded from configuration.",
    requirement: { brain: [...BRAIN_CORE], harness: [...HARNESS_CORE] },
    review: { enabled: true, mode: "independent", maxRevisions: 8 },
    revision: { enabled: true },
    handoff: { enabled: true },
    brainless: false,
    steps: ["init", "inspect", "plan", "dispatch", "execute", "review", "revise", "done"],
  },
};

export function getWorkflow(id: string): WorkflowDefinition | null {
  return isWorkflowId(id) ? BUILTIN_WORKFLOWS[id] : null;
}

export function workflowSupportsStep(
  workflow: WorkflowDefinition,
  step: WorkflowStep
): boolean {
  return workflow.steps.includes(step);
}
