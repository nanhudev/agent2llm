/**
 * Test runner.
 *
 * Tests live in `tests/*.mjs`, import the built packages through their
 * published entry points, and register cases via @agent2llm/testing. Each
 * file runs in its own process with an isolated AGENT2LLM_STATE_DIR so no
 * test can read or corrupt the developer's real state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");

if (!fs.existsSync(TESTS_DIR)) {
  console.error("tests/ directory not found");
  process.exit(1);
}

const filter = process.argv[2];
const files = fs
  .readdirSync(TESTS_DIR)
  .filter((file) => file.endsWith(".test.mjs"))
  .filter((file) => !filter || file.includes(filter))
  .sort();

if (files.length === 0) {
  console.error("no test files matched");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const started = Date.now();

for (const file of files) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-test-state-"));
  const result = spawnSync(process.execPath, [path.join(TESTS_DIR, file)], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, AGENT2LLM_STATE_DIR: stateDir, NO_COLOR: "1", AGENT2LLM_LOG_LEVEL: "error" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lines = output.trim().split("\n").filter(Boolean);
  const filePassed = Number.parseInt(lines.find((l) => l.startsWith("PASS:"))?.slice(5) ?? "0", 10) || 0;
  const fileFailed = Number.parseInt(lines.find((l) => l.startsWith("FAIL:"))?.slice(5) ?? "0", 10) || 0;
  const bad = result.status !== 0 && filePassed + fileFailed === 0 ? 1 : 0;

  passed += filePassed;
  failed += fileFailed + bad;

  const mark = fileFailed + bad === 0 ? "ok  " : "FAIL";
  console.log(`${mark} ${file}  ${filePassed} passed${fileFailed + bad ? `, ${fileFailed + bad} failed` : ""}`);
  if (fileFailed + bad > 0) {
    for (const line of lines.filter((l) => l.startsWith("  x "))) console.log(`     ${line}`);
    if (bad) console.log(output.slice(-2000));
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${passed} passed, ${failed} failed (${seconds}s)`);
process.exit(failed === 0 ? 0 : 1);
