/**
 * A failure sentence must not deny a reason that exists.
 *
 * The case that motivated this file: `dsh --profile headless` died with
 * `UNKNOWN_MODEL: pi-ai provider "qwen25-7b" has no configured model
 * "qwen-local:latest"` — a precise, actionable sentence — printed on stderr,
 * with stdout completely silent. The failure summary said the harness
 * "produced no readable message". That sentence is read by the Brain and by
 * the human debugging the run, and both were told there was nothing to read.
 *
 * The rule pinned here: on failure, stdout's last meaningful line is the
 * summary; when stdout has none, stderr's is; only when neither has anything
 * meaningful does the summary fall back to the exit-code sentence.
 */
import { test, assert } from "@agent2llm/testing";
import { summarizeOutcome } from "@agent2llm/harness-cli-runtime";
import { report } from "./_report.mjs";

const FAIL = (stdout = "", stderr = "") => ({
  exitCode: 1,
  signal: null,
  timedOut: false,
  durationMs: 1200,
  stdout,
  stderr,
});

const ACC = (exitStatus = "1") => ({
  ok: false,
  exitStatus,
  changedFiles: [],
  tests: null,
  summary: "",
  commands: [],
  sessionRef: null,
});

test("cli-outcome", "a silent stdout does not erase a stderr reason", () => {
  const summary = summarizeOutcome(
    "DeepSeek Harness",
    FAIL("", 'dsh: UNKNOWN_MODEL: pi-ai provider "qwen25-7b" has no configured model "qwen-local:latest"'),
    ACC(),
    null,
    "",
    'dsh: UNKNOWN_MODEL: pi-ai provider "qwen25-7b" has no configured model "qwen-local:latest"'
  );
  assert(summary.includes("UNKNOWN_MODEL"), `the reason must be surfaced, got: ${summary}`);
  assert(
    !summary.includes("no readable message"),
    `the summary must not deny the message it carried, got: ${summary}`
  );
});

test("cli-outcome", "stdout still wins when it has something to say", () => {
  const summary = summarizeOutcome(
    "Some Harness",
    FAIL("final words from the agent", "a stderr complaint"),
    ACC(),
    null,
    "final words from the agent",
    "a stderr complaint"
  );
  assert(summary.includes("final words"), `stdout is the harness's own voice, got: ${summary}`);
  assert(!summary.includes("stderr complaint"), "stderr must not override stdout");
});

test("cli-outcome", "json-shaped stderr noise is still not a reason", () => {
  const summary = summarizeOutcome(
    "Some Harness",
    FAIL("", '{"error":"truncated fragment of a blob'),
    ACC(),
    null,
    "",
    '{"error":"truncated fragment of a blob'
  );
  assert(
    summary.includes("no readable message"),
    `meaningfulLine's existing rejections must keep holding, got: ${summary}`
  );
});

test("cli-outcome", "a spawn failure's ENOENT is a readable reason", () => {
  // subprocess.ts appends the spawn error to stderr; the summary must repeat
  // it instead of claiming the harness said nothing.
  const message = "spawn C:\\npm\\dsh EINVAL";
  const summary = summarizeOutcome("Some Harness", FAIL("", `\n${message}`), ACC(), null, "", `\n${message}`);
  assert(summary.includes("EINVAL"), `the spawn error must reach the summary, got: ${summary}`);
});

await report();
