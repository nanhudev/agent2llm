/**
 * review-only: the Harness works autonomously and the Brain reviews at the end.
 *
 * Note `review.mode: independent` — even here the Brain must inspect the real
 * workspace through the data plane before judging. An advisory review would
 * make the whole exercise decorative.
 */
import { BUILTIN_WORKFLOWS, defineWorkflow } from "@agent2llm/core";

export const reviewOnly = defineWorkflow(BUILTIN_WORKFLOWS["review-only"]);

export default reviewOnly;
