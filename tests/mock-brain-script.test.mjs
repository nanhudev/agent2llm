/**
 * The mock Brain's script can arrive from the environment.
 *
 * `npm run e2e:relay` needs this: it drives the real CLI, which registers the
 * mock Brain by id and has no way to hand it a JavaScript object, so the plan
 * the Brain is to follow has to come off disk as data.
 *
 * The loader is strict on purpose. If a malformed script silently fell back to
 * the default four-step brain-hands script, the acceptance run would still
 * print a summary — one describing a plan that is not the plan on disk. An
 * acceptance run that can quietly execute something else is worse than no
 * acceptance run, so every malformed input throws and names the file.
 *
 * The last two tests are about precedence rather than parsing: the environment
 * sits *below* the constructor argument, so an in-process test that passes a
 * script is never surprised by the machine it happens to run on.
 */
import fs from "node:fs";
import path from "node:path";
import { test, assert, assertEqual, assertThrows } from "@agent2llm/testing";
import { createMockBrain, scriptFromEnvironment } from "@agent2llm/brain-mock";
import { scratchDir } from "./_scratch.mjs";
import { report } from "./_report.mjs";

const ENV_KEY = "A2L_MOCK_BRAIN_SCRIPT";

/** Writes one script file into a fresh scratch directory and returns its path. */
function scriptFile(steps) {
  const file = path.join(scratchDir("a2l-mock-script"), "steps.json");
  fs.writeFileSync(file, JSON.stringify(steps));
  return file;
}

/** Runs `body` with the variable set, and always puts the machine back. */
async function withEnvScript(file, body) {
  const previous = process.env[ENV_KEY];
  process.env[ENV_KEY] = file;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  }
}

/** The first thing this Brain says, which is the first step of its script. */
async function firstReply(brain) {
  const session = await brain.createSession({
    sessionId: "a2ls_script",
    taskId: "a2lt_script",
    workspaceId: "ctx_script",
    workspaceRoot: process.cwd(),
    goal: "read the plan",
  });
  return brain.awaitControl(session);
}

test("mock-brain-script", "an unset variable is not an empty plan", () => {
  assertEqual(scriptFromEnvironment({}), undefined, "no variable means the caller's default applies");
});

test("mock-brain-script", "a well-formed file is read and returned intact", () => {
  const file = scriptFile([
    { type: "NEXT_ACTION", task: "write one file", acceptance: ["it exists"] },
    { type: "DONE", summary: "ok" },
  ]);
  const steps = scriptFromEnvironment({ [ENV_KEY]: file });

  assertEqual(steps.length, 2, "both steps survive");
  assertEqual(steps[0].type, "NEXT_ACTION", "in order");
  assertEqual(steps[0].task, "write one file", "with their payloads");
  assertEqual(steps[0].acceptance[0], "it exists", "including the nested ones");
});

test("mock-brain-script", "every malformed script throws and says which file", () => {
  const absent = path.join(scratchDir("a2l-mock-script"), "absent.json");
  const notJson = path.join(scratchDir("a2l-mock-script"), "steps.json");
  fs.writeFileSync(notJson, "{ this is not json");

  const cases = [
    ["the file does not exist", absent, /could not be read/],
    ["the file is not JSON", notJson, /not valid JSON/],
    ["the file is an empty array", scriptFile([]), /non-empty array/],
    ["the file is an object, not an array", scriptFile({ type: "DONE" }), /non-empty array/],
    ["a step has an unknown type", scriptFile([{ type: "THINK_HARDER", task: "x" }]), /step 0 has type/],
    [
      "a step is missing a required field",
      scriptFile([{ type: "DONE", summary: "ok" }, { type: "NEXT_ACTION" }]),
      /step 1 \(NEXT_ACTION\) is missing 'task'/,
    ],
  ];

  for (const [label, file, pattern] of cases) {
    const error = assertThrows(
      () => scriptFromEnvironment({ [ENV_KEY]: file }),
      `${label} must throw rather than fall back to the default plan`
    );
    assert(pattern.test(error.message), `${label}: message must explain it, got: ${error.message}`);
    assert(error.message.includes("A2L_MOCK_BRAIN_SCRIPT"), `${label}: message must name the variable`);
  }
});

test("mock-brain-script", "the constructor reads the environment when given no script", async () => {
  const file = scriptFile([{ type: "DONE", summary: "the plan from disk" }]);
  await withEnvScript(file, async () => {
    const reply = await firstReply(createMockBrain());
    assertEqual(reply.type, "DONE", "the environment script is the one that ran");
    assertEqual(reply.payload.summary, "the plan from disk", "and its content came through");
  });
});

test("mock-brain-script", "an explicit script outranks the environment", async () => {
  const file = scriptFile([{ type: "DONE", summary: "the plan from disk" }]);
  await withEnvScript(file, async () => {
    const reply = await firstReply(createMockBrain({ script: [{ type: "DONE", summary: "the plan passed in" }] }));
    assertEqual(
      reply.payload.summary,
      "the plan passed in",
      "an in-process test must not be at the mercy of the machine it runs on"
    );
  });
});

await report();
