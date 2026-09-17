/**
 * A CLI harness must be able to find itself before it reports that it cannot.
 *
 * Found by the end-to-end run, not by a unit test, because every Relay test
 * used the mock harness — which has no binary and therefore no discovery step
 * to get wrong. Against real Codex the run stopped at
 * `Codex is not installed or not on PATH`, while `agent2llm detect` named that
 * same binary's full path: `execute()` asked `requireBinary()` for a location
 * that only a probe can fill, and Relay negotiates no capabilities, so nothing
 * had probed.
 *
 * This test uses `node` itself as the harness binary: a real process on PATH,
 * a real spawn, and no dependency on any product being installed.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { CliHarnessAdapter } from "@agent2llm/harness-cli-runtime";
import { report } from "./_report.mjs";

/** The smallest possible CLI harness: `node -e 'process.exit(0)'`. */
class ProbeHarness extends CliHarnessAdapter {
  constructor() {
    super({ id: "probe-harness", name: "Probe Harness", bin: "node", vendor: "test" });
  }

  buildArgs() {
    return ["-e", "process.exit(0)"];
  }

  detected() {
    return this.isDetected();
  }
}

test("cli-harness-dispatch", "a fresh CLI harness has not looked for its binary yet", () => {
  const harness = new ProbeHarness();
  assertEqual(harness.detected(), false, "construction must not probe the disk");
});

test("cli-harness-dispatch", "execute() discovers the binary itself", async () => {
  const harness = new ProbeHarness();
  const session = await harness.createSession({
    workspaceId: "w",
    workspaceRoot: process.cwd(),
    sessionId: "s",
    taskId: "t",
    goal: "g",
  });

  // Nothing has asked for capabilities, so nothing has looked. Before the fix
  // this threw `harnessUnavailable` for a binary that is literally running the
  // test.
  const handle = await harness.execute(session, {
    taskId: "t",
    iteration: 0,
    workspaceId: "w",
    workspaceRoot: process.cwd(),
    instructions: [],
  });

  assertEqual(harness.detected(), true, "the dispatch is what discovers, and it must have");
  assert(typeof handle.id === "string" && handle.id.length > 0, "and a real process was started");
  await harness.cancel(handle).catch(() => undefined);
  await harness.close(session);
});

test("cli-harness-dispatch", "a binary that is genuinely absent still fails honestly", async () => {
  class MissingHarness extends CliHarnessAdapter {
    constructor() {
      super({ id: "missing", name: "Missing", bin: "a2l-no-such-binary-anywhere" });
    }
    buildArgs() {
      return [];
    }
  }
  const harness = new MissingHarness();
  const session = await harness.createSession({
    workspaceId: "w",
    workspaceRoot: process.cwd(),
    sessionId: "s",
    taskId: "t",
    goal: "g",
  });

  let message = "";
  try {
    await harness.execute(session, { taskId: "t", iteration: 0, workspaceId: "w", workspaceRoot: process.cwd(), instructions: [] });
  } catch (error) {
    message = error.message;
  }
  assert(message !== "", "an absent binary is still an error, not an empty dispatch");
  assert(
    /not installed or not on PATH/.test(message),
    `and it still says what is wrong, got: ${message}`
  );
});

await report();
