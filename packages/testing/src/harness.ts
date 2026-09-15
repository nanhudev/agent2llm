/**
 * Test registration and execution.
 *
 * Agent2LLM must be verifiable with `node scripts/run-tests.mjs` and no test
 * framework installed, so the harness is small and lives in-repo.
 */
import type { AssertionError } from "./assert.js";

export interface TestContext {
  name: string;
}

export type TestFn = (t: TestContext) => void | Promise<void>;

export interface RegisteredTest {
  suite: string;
  name: string;
  fn: TestFn;
}

const tests: RegisteredTest[] = [];

export function test(suite: string, name: string, fn: TestFn): void {
  tests.push({ suite, name, fn });
}

export function describe(suite: string): (name: string, fn: TestFn) => void {
  return (name, fn) => test(suite, name, fn);
}

export function registeredTests(): RegisteredTest[] {
  return [...tests];
}

export interface SuiteResult {
  suite: string;
  name: string;
  ok: boolean;
  error?: string;
}

export async function runAll(): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  for (const entry of tests) {
    try {
      await entry.fn({ name: entry.name });
      results.push({ suite: entry.suite, name: entry.name, ok: true });
    } catch (error) {
      results.push({
        suite: entry.suite,
        name: entry.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export type { AssertionError };
