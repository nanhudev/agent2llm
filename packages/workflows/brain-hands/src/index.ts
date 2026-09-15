/**
 * brain-hands: the default workflow.
 *
 * Exported from its own package to prove the point that a workflow is data:
 * the orchestrator interprets this object, it does not switch on an id.
 */
import { BUILTIN_WORKFLOWS, defineWorkflow } from "@agent2llm/core";

export const brainHands = defineWorkflow(BUILTIN_WORKFLOWS["brain-hands"]);

export default brainHands;
