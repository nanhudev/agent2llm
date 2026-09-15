/** Dependency-free assertions used by every Agent2LLM test. */
export class AssertionError extends Error {}

export function assert(condition: unknown, message: string): void {
  if (!condition) throw new AssertionError(message);
}

export function assertEqual<T>(actual: T, expected: T, message = "values differ"): void {
  if (actual !== expected) {
    throw new AssertionError(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message = "objects differ"): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new AssertionError(`${message}: expected ${b}, got ${a}`);
}

export function assertThrows(fn: () => unknown, message = "expected a throw"): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof AssertionError) throw error;
    return error;
  }
  throw new AssertionError(message);
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  matcher?: string | RegExp,
  message = "expected a rejection"
): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    if (matcher) {
      const text = error instanceof Error ? error.message : String(error);
      const ok = typeof matcher === "string" ? text.includes(matcher) : matcher.test(text);
      if (!ok) throw new AssertionError(`${message}: got "${text}"`);
    }
    return error;
  }
  throw new AssertionError(message);
}
