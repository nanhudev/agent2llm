/**
 * Line-level helpers shared by every CLI harness adapter.
 *
 * These are deliberately free of any adapter state: they take a string and
 * return a value, so a harness can be tested against a recorded output sample
 * without standing up a process. Kept in their own module so `index.ts` stays
 * inside the project's 400-line budget as more products are added.
 */

/** The running tally one execution round builds up for the Brain to review. */
export interface ExecutionAccumulator {
  ok: boolean;
  exitStatus: string;
  changedFiles: string[];
  tests: string | null;
  summary: string;
  commands: string[];
  sessionRef: string | null;
}

/**
 * A line worth showing a human, or null.
 *
 * Rejects the shapes that look like content and are not. A failing CLI is
 * chatty: it retries, falls back between transports, and prints whatever the
 * far end returned — which for a gateway is often an HTML page. None of that
 * answers "why did this fail?" better than the exit code already does.
 */
export function meaningfulLine(line: string): string | null {
  const text = line.trim();
  if (text === "") return null;
  // The middle of a JSON object.
  if (/^[{[,"]/.test(text)) return null;
  // Mark-up, at the start or anywhere in a line that is mostly tags.
  if (/^<\/?[a-z!]/i.test(text)) return null;
  if (/<html|<!doctype|<head>|<body>/i.test(text)) return null;
  // Retry and transport chatter — includes the embedded-error variant, where
  // the harness wraps a gateway response inside its own progress message.
  if (/reconnecting/i.test(text)) return null;
  // A wrapped status line: "… unexpected status 403 Forbidden …".
  if (/unexpected status \d{3}/i.test(text)) return null;
  return text;
}

/** Shared helper: pull a JSON object out of a possibly-prefixed line. */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}
