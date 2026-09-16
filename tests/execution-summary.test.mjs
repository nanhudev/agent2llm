/**
 * What the Brain is told when execution ends.
 *
 * The failure this pins is a communication one, not a crash. When Codex could
 * not reach its backend it emitted a structured error and then kept talking —
 * retries, a transport fallback, a wall of HTML from the gateway. The last
 * line was a truncated fragment of that, and it travelled to the Brain as the
 * `result` of the run. A reviewer reading `{"type":"item.completed","item":{
 * "id":"item_1","type":"error","message":"Falling back…` learns nothing.
 *
 * So the rule under test: a structured failure wins, then a timeout, then the
 * last line — and the last line only counts if it is prose. JSON fragments,
 * mark-up and retry chatter are not.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { CodexHarnessAdapter, createCodexHarness } from "@agent2llm/harness-codex";
import { report } from "./_report.mjs";

/**
 * `summarize` is protected, so it is exercised the way a reviewer would see
 * it: through a real adapter fed real lines. Calling it directly keeps the
 * test about the decision table rather than about spawning a process.
 */
function summarizer() {
  return createCodexHarness().summarize.bind(createCodexHarness());
}

const OK_OUTCOME = { exitCode: 0, signal: null, timedOut: false, durationMs: 1200, stdout: "", stderr: "" };
const FAIL_OUTCOME = { exitCode: 1, signal: null, timedOut: false, durationMs: 1200, stdout: "", stderr: "" };
const TIMEOUT_OUTCOME = { exitCode: null, signal: "SIGTERM", timedOut: true, durationMs: 5000, stdout: "", stderr: "" };

const ACC = { ok: false, exitStatus: "1", changedFiles: [], tests: null, summary: "", commands: [], sessionRef: null };

test("execution-summary", "a structured failure outranks whatever was printed last", async () => {
  const summarize = summarizer();
  const summary = summarize(
    FAIL_OUTCOME,
    ACC,
    "unexpected status 403 Forbidden",
    '{"type":"error","message":"Reconnecting... 2/5"}'
  );
  assertEqual(summary, "unexpected status 403 Forbidden", "the harness's own reason must win");
});

test("execution-summary", "a timeout says so, regardless of trailing output", async () => {
  const summarize = summarizer();
  const summary = summarize(TIMEOUT_OUTCOME, { ...ACC, exitStatus: "timeout" }, null, "still working");
  assert(summary.includes("timed out"), `expected a timeout sentence, got: ${summary}`);
  assert(summary.includes("5s"), "the elapsed time is worth stating");
});

test("execution-summary", "a successful run hands over the agent's final message", async () => {
  const summarize = summarizer();
  const summary = summarize(OK_OUTCOME, { ...ACC, exitStatus: "0" }, null, "Created NOTES.md with two lines.");
  assertEqual(summary, "Created NOTES.md with two lines.", "the last line is the deliverable");
});

test("execution-summary", "a success with nothing to say still says something", async () => {
  const summarize = summarizer();
  const summary = summarize(OK_OUTCOME, { ...ACC, exitStatus: "0" }, null, "");
  assert(summary.includes("finished successfully"), `expected a plain success line, got: ${summary}`);
});

test("execution-summary", "a JSON fragment is not a summary", async () => {
  const summarize = summarizer();
  const cases = [
    '{"type":"item.completed","item":{',
    '", url: wss://chatgpt.com/backend-api/codex/responses',
    '[{"id":"item_0"}]',
  ];
  for (const line of cases) {
    const summary = summarize(FAIL_OUTCOME, ACC, null, line);
    assert(
      summary.includes("no readable message"),
      `a JSON fragment must not pass through, got: ${summary}`
    );
  }
});

test("execution-summary", "an HTML error page is not a summary", async () => {
  const summarize = summarizer();
  const summary = summarize(FAIL_OUTCOME, ACC, null, "<html>");
  assert(summary.includes("no readable message"), `mark-up must not pass through, got: ${summary}`);
});

test("execution-summary", "retry chatter is not a summary", async () => {
  const summarize = summarizer();
  const summary = summarize(FAIL_OUTCOME, ACC, null, "Reconnecting... 3/5 (unexpected status 403 Forbidden)");
  assert(summary.includes("no readable message"), `retry chatter must not pass through, got: ${summary}`);
});

test("execution-summary", "a genuine failure sentence does pass through", async () => {
  const summarize = summarizer();
  const summary = summarize(FAIL_OUTCOME, ACC, null, "Error: the sandbox could not be created.");
  assertEqual(summary, "Error: the sandbox could not be created.", "real prose must survive");
});

test("execution-summary", "an unreadable failure names the exit code rather than lying", async () => {
  const summarize = summarizer();
  const summary = summarize(FAIL_OUTCOME, { ...ACC, exitStatus: "1" }, null, "");
  assert(summary.includes("exit code 1"), `expected the code to be reported, got: ${summary}`);
});

test("execution-summary", "summaries are bounded to what the payload accepts", async () => {
  const summarize = summarizer();
  const summary = summarize(OK_OUTCOME, { ...ACC, exitStatus: "0" }, null, "x".repeat(2000));
  assert(summary.length <= 500, `a summary must fit the payload budget, got ${summary.length}`);
});

test("execution-summary", "the wording is overridable, so a product can rephrase it", async () => {
  // `summarize` is protected rather than private: it is the one place a
  // product adapter may want its own vocabulary, and the contract suite
  // exercises the base behaviour for every adapter either way.
  const adapter = new CodexHarnessAdapter();
  assertEqual(typeof adapter.summarize, "function", "subclasses must be able to override the wording");
});

await report();
