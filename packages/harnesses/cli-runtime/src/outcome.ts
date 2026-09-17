/**
 * One sentence the Brain can act on, plus the test seam for the dispatch brief.
 *
 * Both live here rather than on the adapter base class for the same reason the
 * line helpers do: they are decisions about *evidence*, and the base class is
 * long enough that a further addition would push it past the module budget.
 */
import type { ExecutionRequest } from "@agent2llm/adapter-sdk";
import type { RunOutcome } from "@agent2llm/transports";
import { meaningfulLine, type ExecutionAccumulator } from "./helpers.js";

/**
 * The single sentence handed to the Brain for a finished execution.
 *
 * Order matters. A structured failure beats everything: it is the harness
 * saying what went wrong, in its own vocabulary. A timeout is next. Only then
 * does the last line of output get a turn, and even then it is worth checking
 * that it is prose rather than the middle of a JSON blob — a truncated
 * serialisation reads as noise to a reviewer.
 *
 * On success the last line is usually the agent's own final message, which is
 * exactly what we want to hand over.
 */
export function summarizeOutcome(
  productName: string,
  outcome: RunOutcome,
  acc: ExecutionAccumulator,
  firstFailure: string | null,
  lastText: string,
  lastStderr = ""
): string {
  if (outcome.timedOut) {
    return `${productName} timed out after ${Math.round(outcome.durationMs / 1000)}s.`;
  }
  if (firstFailure) return firstFailure.slice(0, 500);
  if (outcome.exitCode === 0) {
    return (lastText || `${productName} finished successfully.`).slice(0, 500);
  }
  // A failing CLI often puts the only readable reason on stderr — the case
  // that motivated this: `dsh --profile headless` died with
  // `UNKNOWN_MODEL: pi-ai provider … has no configured model …` on stderr
  // and nothing at all on stdout, yet the summary claimed there was no
  // readable message. Stdout is still preferred: it is where a harness's own
  // final words live when things work.
  const readable = meaningfulLine(lastText) || meaningfulLine(lastStderr);
  if (readable) return readable.slice(0, 500);
  return `${productName} failed with exit code ${acc.exitStatus} and produced no readable message.`;
}

/**
 * Test seam for the brief every CLI harness sends.
 *
 * `renderTask` is protected because it is a product hook, but the thing worth
 * asserting is not product-specific: a relay dispatch must not leak the run's
 * goal or a product's house rules into the Harness prompt. Testing it through
 * a real adapter invocation would need a binary installed; this reaches the
 * same method without one.
 */
export function renderTaskFor(adapter: unknown, task: ExecutionRequest): string {
  return (adapter as { renderTask(t: ExecutionRequest): string }).renderTask(task);
}
