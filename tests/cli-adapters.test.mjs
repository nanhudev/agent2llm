/**
 * `a2l adapters`, driven as a real process: the default view is what this
 * machine can actually use, and `--all` is the full registry.
 *
 * The claim being tested is an honesty one. A table that lists every adapter
 * the CLI *knows about* reads as "these are the adapters I have" — and
 * "implemented" is not installed; it is code waiting for a product that is
 * not on this machine. So the default table must contain an adapter exactly
 * when detection called it usable today, the filtered-out count must be
 * printed rather than silently dropped, and `--all` must still offer the
 * complete map.
 *
 * The assertions are machine-independent by construction: the expected set
 * comes from the same run's `--json` output, never from a hardcoded list of
 * what the repo's authors happen to have installed.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "apps", "cli", "dist", "index.js");
const STATE = path.join(process.env.AGENT2LLM_STATE_DIR ?? ROOT, "cli-adapters");

/** Statuses the default view treats as "usable on this machine today". */
const READY = new Set(["verified", "detected", "configured", "authenticated"]);

function a2l(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: STATE, NO_COLOR: "1" },
  });
}

function detectOnce() {
  const jsonRun = a2l("adapters", "--json");
  assertEqual(jsonRun.status, 0, `adapters --json failed: ${jsonRun.stderr || jsonRun.stdout}`);
  const results = JSON.parse(jsonRun.stdout);
  assert(Array.isArray(results) && results.length > 0, "the registry has entries to report");
  return results;
}

test("cli-adapters", "the built CLI entry point exists", () => {
  assert(fs.existsSync(CLI), `${CLI} must exist — the suite runs against built output (npm run build)`);
});

test("cli-adapters", "the default table lists an adapter exactly when detection called it usable", () => {
  const results = detectOnce();
  const human = a2l("adapters");
  assertEqual(human.status, 0, `the human view failed: ${human.stderr}`);
  for (const result of results) {
    assertEqual(
      human.stdout.includes(result.id),
      READY.has(result.detection.status),
      `${result.id} (status ${result.detection.status}) must be in the default table exactly when its status means usable`
    );
  }
});

test("cli-adapters", "the filtered-out count is printed, and --all still lists everything", () => {
  const results = detectOnce();
  const hidden = results.filter((result) => !READY.has(result.detection.status));
  const all = a2l("adapters", "--all");
  assertEqual(all.status, 0, `--all failed: ${all.stderr}`);
  for (const result of results) {
    assert(all.stdout.includes(result.id), `--all lists ${result.id} regardless of status`);
  }
  if (hidden.length === 0) return; // everything installed here; nothing was filtered, so nothing to assert
  const human = a2l("adapters");
  assert(
    human.stdout.includes(`${hidden.length} more need setup`),
    `the default view says how many were left out: ${human.stdout.trim()}`
  );
});

test("cli-adapters", "--json stays complete even though the table filters", () => {
  const plain = detectOnce();
  const all = a2l("adapters", "--all", "--json");
  assertEqual(all.status, 0, "--all --json runs");
  assertEqual(JSON.parse(all.stdout).length, plain.length,
    "the JSON payload is the full registry either way — the filter is a rendering choice, not a data one");
});

await report();
