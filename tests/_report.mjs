/**
 * Shared reporter. Each `tests/*.test.mjs` file registers cases with
 * @agent2llm/testing and finishes with `await report()`, which prints the
 * machine-readable summary that scripts/run-tests.mjs aggregates.
 */
import { runAll } from "@agent2llm/testing";

export async function report() {
  const results = await runAll();
  const passed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    console.log(`  x ${result.suite} > ${result.name}: ${result.error}`);
  }
  console.log(`PASS: ${passed.length}`);
  console.log(`FAIL: ${failed.length}`);
}
