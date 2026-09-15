/**
 * planner-only: the Brain plans, the Harness executes once, no review loop.
 */
import { BUILTIN_WORKFLOWS, defineWorkflow } from "@agent2llm/core";

export const plannerOnly = defineWorkflow(BUILTIN_WORKFLOWS["planner-only"]);

export default plannerOnly;
