/** * Evidence: what Agent2LLM can prove about an execution, and how little of it
 * the Brain has to read.
 *
 * Two failures are modelled here.
 *
 * The first is trusting the harness. An agent that says "done — 6 tests pass,
 * I changed src/slugify.ts" is making three claims, and only one of them
 * (the exit code) is something this system has ever been able to check. Git
 * can check the second. So the collector reads the repository and records
 * where the two accounts disagree, including the case where the harness claims
 * changes in a tree where nothing moved at all.
 *
 * The second is arithmetic. A twelve-file change is a diff in the tens of
 * thousands of tokens; sending it to a web Brain every iteration is how a
 * cheap pairing becomes an expensive one. The compact form is a few hundred
 * characters, and the Brain asks for one diff at a time when it needs one.
 *
 * These tests build a real repository with real git. A mocked git would test
 * the mock.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import {
  collectEvidence,
  compressEvidence,
  parseDetailRequest,
  parseTestsPassed,
  renderDetail,
  evidenceSizes,
  MAX_COMPACT_CHARS,
} from "@agent2llm/evidence";
import { scratchDir } from "./_scratch.mjs";
import { report } from "./_report.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

/** A repository with one commit, so "changed" has something to mean. */
function scratchRepo(name) {
  const dir = scratchDir(`a2l-evidence-${name}`);
  git(dir, "init", "--quiet");
  git(dir, "config", "user.email", "test@agent2llm.local");
  git(dir, "config", "user.name", "Agent2LLM Test");
  git(dir, "config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const app = 1;\n");
  git(dir, "add", ".");
  git(dir, "commit", "--quiet", "-m", "initial");
  return dir;
}

function receipt(overrides = {}) {
  return {
    receiptId: "a2lx_test",
    runId: "a2lr_test",
    iteration: 1,
    status: "success",
    exitStatus: "0",
    changedFiles: [],
    tests: null,
    testsPassed: null,
    commands: [],
    errors: [],
    summary: "Done.",
    durationMs: 100,
    at: new Date().toISOString(),
    ...overrides,
  };
}

test("evidence", "the repository decides what changed, not the harness", async () => {
  const root = scratchRepo("real");
  // The harness names one file; the real change is in a different one.
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = 2;\nexport const extra = true;\n");

  const evidence = await collectEvidence({
    workspaceRoot: root,
    receipt: receipt({ changedFiles: ["src/app.ts"] }),
  });


  assertEqual(evidence.git.isRepo, true, "the repository must be found");
  assertEqual(evidence.git.files.length, 1, "git reports exactly one changed file");
  assertEqual(evidence.git.files[0].path, "src/app.ts", "the path is the repository's own");
  assert(evidence.git.files[0].added > 0, "the added-line count comes from numstat, not from a guess");
  assertEqual(evidence.verdict, "corroborated", "an overlapping claim is corroborated");
  assertEqual(evidence.claimedButUnchanged.length, 0, "the claimed file really did change");
});

test("evidence", "a success that changed nothing is contradicted, not believed", async () => {
  const root = scratchRepo("clean");

  const evidence = await collectEvidence({
    workspaceRoot: root,
    receipt: receipt({ changedFiles: ["src/slugify.ts"], tests: "6 passed" }),
  });

  assertEqual(evidence.git.clean, true, "nothing moved");
  assertEqual(evidence.verdict, "contradicted", "a clean tree contradicts a claimed change");
  assert(
    /clean|could not be/i.test(evidence.verdictReason),
    `the reason must name the contradiction, got: ${evidence.verdictReason}`
  );
  assertEqual(evidence.claimedButUnchanged.length, 1, "the unconfirmed claim is recorded");
});

test("evidence", "an execution with nothing to write is not a failure", async () => {
  const root = scratchRepo("noop");
  // "Run the tests and tell me" legitimately changes nothing. Reporting that
  // as a contradiction would train the Brain to ignore the signal.
  const evidence = await collectEvidence({ workspaceRoot: root, receipt: receipt({ changedFiles: [] }) });

  assertEqual(evidence.verdict, "corroborated", "a clean tree with no claims is consistent");
  assertEqual(evidence.claimedButUnchanged.length, 0, "nothing was claimed");
});

test("evidence", "a directory that is not a repository is unverified, and says so", async () => {
  const dir = scratchDir("a2l-evidence-plain");
  const evidence = await collectEvidence({ workspaceRoot: dir, receipt: receipt({ changedFiles: ["x.ts"] }) });

  assertEqual(evidence.git.isRepo, false, "no repository, no git facts");
  assertEqual(evidence.verdict, "unverified", "the claim is not corroborated by anything");
  assert(evidence.git.unavailable, "the record must say why it could not verify");

  const compact = compressEvidence(evidence);
  assert(
    /unverified/i.test(compact),
    `the compact form must admit the gap rather than present the claim as fact, got: ${compact}`
  );
  assert(
    /claimed by the harness, unverified/.test(compact),
    `the file list must be labelled as the harness's account, got: ${compact}`
  );
});

test("evidence", "the compact form is small, bounded, and there when asked for detail", async () => {
  const root = scratchRepo("big");
  // A change big enough that its raw diff dwarfs the summary several times over.
  for (let index = 0; index < 40; index += 1) {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const body = Array.from({ length: 200 }, (_, line) => `export const v${line} = ${index * 1000 + line};`).join("\n");
    fs.writeFileSync(path.join(root, "src", `mod${index}.ts`), `${body}\n`);
  }

  const files = Array.from({ length: 40 }, (_, index) => `src/mod${index}.ts`);
  const evidence = await collectEvidence({
    workspaceRoot: root,
    receipt: receipt({ changedFiles: files, tests: "18 passed", commands: ["npm test"] }),
  });

  const compact = compressEvidence(evidence);
  const sizes = evidenceSizes(evidence, compact);

  assert(compact.length <= MAX_COMPACT_CHARS, `compact form must fit the budget, got ${compact.length}`);
  assert(compact.includes("src/mod0.ts"), "files are named with their line counts");
  assert(compact.includes("18 passed"), "the test result survives compression");
  assert(compact.includes("npm test"), "the command survives compression");
  assert(compact.includes("SHOW_DIFF"), "the compact form tells the Brain how to ask for more");
  assert(
    sizes.raw.estimatedTextTokens > sizes.compact.estimatedTextTokens * 2,
    `the raw record should be much larger: raw=${sizes.raw.estimatedTextTokens} compact=${sizes.compact.estimatedTextTokens}`
  );

  // The detail request is what makes the compression lossless in practice.
  const request = parseDetailRequest(`Looks plausible.\n\nSHOW_DIFF src/mod0.ts`);
  assert(request, "a SHOW_DIFF line must parse");
  assertEqual(request.file, "src/mod0.ts", "the requested path is the one asked for");

  const detail = await renderDetail(evidence, request);
  assert(detail.text.includes("export const v0"), "the on-demand detail is the real diff");
  assert(detail.text.length > compact.length, "detail is bigger than the summary, which is why it is on demand");

  assertEqual(parseDetailRequest("nothing to see here"), null, "no request means no request");
});

test("evidence", "a test count is read, not invented", () => {
  assertEqual(parseTestsPassed("18 passed"), 18, "plain form");
  assertEqual(parseTestsPassed("18 passed, 2 failed"), 18, "the pass count survives failures");
  assertEqual(parseTestsPassed("Tests: 6 passing"), 6, "colon form");
  assertEqual(parseTestsPassed("all good"), null, "no number means null, not zero");
  assertEqual(parseTestsPassed(""), null, "empty text means null");
  assertEqual(parseTestsPassed(null), null, "absent text means null");
});

await report();
