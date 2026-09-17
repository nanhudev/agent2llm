#!/usr/bin/env node
/**
 * Relay Mode, end to end, against a real harness.
 *
 *   npm run e2e:relay
 *   npm run e2e:relay -- --harness workbuddy --repo D:\some\scratch
 *
 * Deliberately NOT part of `npm test`. It spends real provider quota and needs
 * a harness that is signed in on this machine, so a failure here is not a
 * broken build — it is a fact about the machine, and the script says which.
 *
 * What it does that no unit test can: a scratch git repository on disk, a real
 * harness process executing real steps, and every acceptance claim read back
 * out of git and the run record rather than taken from the harness's summary.
 * The Brain is the mock, because the reasoning is not what is under test — the
 * loop, the dispatch and the evidence are.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const HARNESS = flag("harness", "codex");
const REPO = path.resolve(flag("repo", "D:\\a2l-relay-e2e"));
const GOAL = flag("goal", "Add a slugify function and tests");

/**
 * The plan the Brain would have produced.
 *
 * Two steps rather than one, because a single step would not distinguish "the
 * harness executed the brief" from "the harness received a goal and did
 * whatever it wanted" — which is the entire difference Relay claims.
 */
const STEPS = [
  {
    type: "NEXT_ACTION",
    task:
      "Create the file src/slugify.js in this repository. It must export one function, slugify(text), " +
      "as a named export: lowercase the input, trim it, replace every run of characters that are not " +
      "letters or digits with a single hyphen, and remove leading and trailing hyphens. " +
      "Use no dependencies and no other file. Do not create a README or any documentation.",
    acceptance: ["src/slugify.js exists", "it exports a function named slugify"],
    files: ["src/slugify.js"],
  },
  {
    type: "NEXT_ACTION",
    task:
      "Create the file tests/slugify.test.mjs using the node:test and node:assert modules, importing " +
      "slugify from '../src/slugify.js'. Cover at least: 'Hello World' -> 'hello-world'; " +
      "'  Trim  Me  ' -> 'trim-me'; punctuation collapsing to single hyphens; and a string that is " +
      "already a slug being returned unchanged. Then run `npm test` in this repository and make sure " +
      "every test passes. Do not add any other file.",
    acceptance: ["tests/slugify.test.mjs exists", "npm test reports all tests passing"],
    files: ["tests/slugify.test.mjs"],
  },
  { type: "DONE", summary: "slugify is implemented and covered by tests that pass." },
];

const checks = [];
/**
 * `ok` is a third state on purpose. Some acceptance claims cannot be evaluated
 * when the harness did nothing — "the harness's file list matched git" is
 * vacuous when it reported no files — and counting a vacuous check as a pass is
 * how a report ends up saying more than was measured.
 */
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  const mark = ok === null ? "----" : ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}\n        ${detail}`);
};

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", cwd: options.cwd ?? ROOT, env: options.env ?? process.env });
}

function git(args, cwd = REPO) {
  return run("git", args, { cwd });
}

// ---- the repository ---------------------------------------------------------

function ensureRepo() {
  if (!fs.existsSync(path.join(REPO, ".git"))) {
    fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
    fs.mkdirSync(path.join(REPO, "tests"), { recursive: true });
    git(["init", "-q"]);
    git(["config", "user.email", "e2e@agent2llm.local"]);
    git(["config", "user.name", "a2l e2e"]);
    fs.writeFileSync(
      path.join(REPO, "package.json"),
      `${JSON.stringify({ name: "a2l-relay-e2e", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test tests/" } }, null, 2)}\n`
    );
    fs.writeFileSync(path.join(REPO, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(
      path.join(REPO, "README.md"),
      "# a2l-relay-e2e\n\nA scratch repository that Relay Mode runs against, end to end.\n"
    );
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "Initial commit: an empty scratch repository"]);
  }
}

// ---- the run ----------------------------------------------------------------

function main() {
  const cli = path.join(ROOT, "dist", "agent2llm.mjs");
  if (!fs.existsSync(cli)) {
    console.error(`No bundle at ${cli}. Run 'npm run bundle' first.`);
    return 2;
  }
  ensureRepo();
  const beforeFiles = git(["status", "--porcelain"]).stdout.trim();

  // A private state directory: this must never touch the pairs a user created.
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-e2e-"));
  const stepsFile = path.join(state, "steps.json");
  fs.writeFileSync(stepsFile, `${JSON.stringify(STEPS, null, 2)}\n`);
  const env = {
    ...process.env,
    AGENT2LLM_STATE_DIR: state,
    A2L_MOCK_BRAIN_SCRIPT: stepsFile,
    NO_COLOR: "1",
  };

  console.log(`\nRelay end-to-end — harness ${HARNESS}`);
  console.log(`  repository: ${REPO}`);
  console.log(`  state:      ${state}\n`);

  const created = run(process.execPath, [cli, "pair", "create", "--brain", "mock-brain", "--harness", HARNESS, "--workspace", REPO, "--json"], { env });
  if (created.status !== 0) {
    console.log(`  BLOCKED  the pair could not be created (exit ${created.status})\n`);
    console.log(created.stdout.trim() || created.stderr.trim());
    return 1;
  }
  const pair = JSON.parse(created.stdout).pair;
  console.log(`  pair ${pair.pairId} · context ${pair.context?.root}\n`);

  const started = Date.now();
  const result = run(process.execPath, [cli, "run", GOAL, "--json"], { env });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // Falls through to an undefined payload, reported below rather than hidden.
  }

  console.log(`  the run took ${elapsed}s\n`);

  // ---- acceptance, read from the repository and the record -----------------

  const changed = git(["status", "--porcelain"]).stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
  record(
    "the harness changed files in the repository",
    changed.length > 0,
    changed.length > 0 ? changed.join(", ") : `nothing changed (was clean: ${beforeFiles === ""})`
  );
  record(
    "the two files the Brain asked for exist",
    fs.existsSync(path.join(REPO, "src", "slugify.js")) && fs.existsSync(path.join(REPO, "tests", "slugify.test.mjs")),
    `${fs.existsSync(path.join(REPO, "src", "slugify.js")) ? "src/slugify.js ✓" : "src/slugify.js ✗"}, ` +
      `${fs.existsSync(path.join(REPO, "tests", "slugify.test.mjs")) ? "tests/slugify.test.mjs ✓" : "tests/slugify.test.mjs ✗"}`
  );

  const tests = run(process.platform === "win32" ? "npm.cmd" : "npm", ["test"], { cwd: REPO });
  const testOutput = `${tests.stdout}${tests.stderr}`;
  const counts = /# pass (\d+)[\s\S]*?# fail (\d+)/.exec(testOutput);
  record(
    "the tests pass, run by this script and not by the harness",
    tests.status === 0 && counts !== null && Number(counts[2]) === 0,
    counts ? `${counts[1]} passing, ${counts[2]} failing (npm test exit ${tests.status})` : `npm test exit ${tests.status}`
  );

  const runsDir = path.join(state, "runs");
  const runFiles = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((file) => file.endsWith(".json")) : [];
  const saved = runFiles.length > 0 ? JSON.parse(fs.readFileSync(path.join(runsDir, runFiles[0]), "utf8")) : null;
  record("a run record was written", saved !== null, saved ? `${runFiles[0]}` : "no run record found");
  record(
    "the Brain called it done",
    saved?.status === "done",
    `run status: ${saved?.status ?? "no record"}, harness exit code: ${result.status}`
  );
  record(
    "evidence was collected from the repository, not from the harness",
    (saved?.metrics.evidenceRaw.bytes ?? 0) > 0 && (saved?.receipts.length ?? 0) > 0,
    saved
      ? `${saved.receipts.length} receipt(s), ${saved.metrics.evidenceRaw.bytes} bytes of raw evidence`
      : "no metrics"
  );
  record(
    "the run took more than one round",
    (saved?.metrics.brainTurns ?? 0) >= 2,
    `${saved?.metrics?.brainTurns ?? 0} brain turn(s) — one would mean the harness was handed the goal instead of a step`
  );

  // The check a harness's own summary can never satisfy: does what it said it
  // did match what the repository says happened?
  const claimed = (saved?.receipts ?? [])
    .flatMap((receipt) => receipt.changedFiles)
    .map((file) => file.replace(/\\/g, "/"));
  const unseen = claimed.filter((file) => !changed.some((actual) => actual.endsWith(path.basename(file))));
  record(
    "what the harness claimed matches what git shows",
    claimed.length === 0 ? null : unseen.length === 0,
    claimed.length === 0
      ? "the harness reported no changed files, so there is nothing to contradict"
      : unseen.length === 0
        ? `all ${claimed.length} claimed file(s) appear in the diff`
        : `claimed but not changed: ${unseen.join(", ")}`
  );

  if (payload?.metrics) {
    const metrics = payload.metrics;
    console.log(
      `\n  metrics: ${metrics.filesChanged} file(s) · ${metrics.evidenceRaw.bytes} B evidence → ` +
        `${metrics.evidenceCompact.bytes} B sent · brain tokens ${metrics.brainTokens === null ? "unavailable" : JSON.stringify(metrics.brainTokens)}`
    );
  }

  const failed = checks.filter((check) => check.ok === false);
  const skipped = checks.filter((check) => check.ok === null);
  const passed = checks.filter((check) => check.ok === true);
  console.log(
    `\n${passed.length}/${checks.length} acceptance checks passed` +
      (skipped.length > 0 ? `, ${skipped.length} not applicable` : "") +
      (failed.length > 0 ? `, ${failed.length} failed` : "") +
      "."
  );
  if (failed.length > 0) {
    console.log(`\n  State kept for inspection: ${state}`);
    if (result.status !== 0 && payload === null) {
      console.log(`  The harness run produced no parseable result:\n${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
  return failed.length === 0 ? 0 : 1;
}

// Slugs are written to disk either way, but the repository is the record.
process.exitCode = main();
