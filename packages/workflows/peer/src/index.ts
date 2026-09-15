/**
 * peer: Brain and Harness both propose and challenge.
 *
 * Only the Harness may mutate the workspace — that invariant lives in the
 * permission policy, not in this file, so no workflow can grant the Brain
 * write access by mistake.
 */
import { BUILTIN_WORKFLOWS, defineWorkflow } from "@agent2llm/core";

export const peer = defineWorkflow({
  ...BUILTIN_WORKFLOWS.peer,
  description:
    "Brain and Harness both propose and challenge each other; only the Harness mutates the workspace.",
});

export default peer;
