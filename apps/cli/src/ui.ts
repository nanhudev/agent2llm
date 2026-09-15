/**
 * Terminal UI primitives.
 *
 * No dependencies: ANSI codes, a readline prompt, a spinner and table
 * rendering. Deliberately not "cyberpunk" — the output should read like a
 * professional tool.
 */
import readline from "node:readline";

export const supportsColor = (): boolean =>
  process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

const C = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

export function paint(color: keyof typeof C, text: string): string {
  if (!supportsColor() || color === "reset") return text;
  return `${C[color]}${text}${C.reset}`;
}

export const bold = (t: string): string => paint("bold", t);
export const dim = (t: string): string => paint("dim", t);
export const ok = (t: string): string => paint("green", t);
export const warn = (t: string): string => paint("yellow", t);
export const fail = (t: string): string => paint("red", t);
export const info = (t: string): string => paint("cyan", t);

export const MARK_OK = ok("✓");
export const MARK_NO = dim("○");
export const MARK_WARN = warn("!");
export const MARK_FAIL = fail("✗");

export function heading(text: string): void {
  process.stdout.write(`\n${bold(text)}\n`);
}

export function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

export interface TableColumn {
  header: string;
  width: number;
}

export function renderTable(columns: TableColumn[], rows: string[][]): string {
  const pad = (value: string, width: number): string => {
    const plain = value.replace(/\u001b\[[0-9;]*m/g, "");
    const visible = plain.length;
    return visible >= width ? value : value + " ".repeat(width - visible);
  };
  const header = columns.map((column, index) => pad(bold(column.header), column.width)).join("  ");
  const body = rows.map((row) => row.map((cell, index) => pad(cell, columns[index]!.width)).join("  "));
  return [header, ...body].join("\n");
}

export async function promptText(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? dim(` (${defaultValue})`) : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === "" ? defaultValue ?? "" : trimmed);
    });
  });
}

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

/** Numbered menu; `1` is the recommended default. */
export async function promptChoice<T>(question: string, choices: Choice<T>[]): Promise<T> {
  line();
  line(bold(question));
  choices.forEach((choice, index) => {
    const hint = choice.hint ? dim(`  ${choice.hint}`) : "";
    line(`  ${index + 1}. ${choice.label}${hint}`);
  });
  for (;;) {
    const answer = await promptText("Select", "1");
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index]!.value;
    line(warn(`Enter a number between 1 and ${choices.length}.`));
  }
}

export interface Spinner {
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  stop(): void;
}

export function spinner(initial: string): Spinner {
  if (!process.stdout.isTTY) {
    line(`  ${initial}`);
    return {
      update: (text) => line(`  ${text}`),
      succeed: (text) => line(`  ${ok("✓")} ${text}`),
      fail: (text) => line(`  ${fail("✗")} ${text}`),
      stop: () => undefined,
    };
  }
  const frames = ["|", "/", "-", "\\"];
  let index = 0;
  let text = initial;
  let timer: NodeJS.Timeout | null = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r\u001b[2K  ${paint("cyan", frames[index]!)} ${text}`);
  }, 100);
  const clear = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    process.stdout.write("\r\u001b[2K");
  };
  return {
    update: (next) => {
      text = next;
    },
    succeed: (next) => {
      clear();
      line(`  ${MARK_OK} ${next}`);
    },
    fail: (next) => {
      clear();
      line(`  ${MARK_FAIL} ${next}`);
    },
    stop: () => clear(),
  };
}

/** One action at a time, inherited from C2C's UX rule. */
export async function requestUserAction(action: {
  kind: string;
  message: string;
  url?: string;
}): Promise<void> {
  line();
  line(`${warn("Action required")} ${dim(`[${action.kind}]`)}`);
  line(`  ${action.message}`);
  if (action.url) line(`  ${info(action.url)}`);
  await promptText("Press Enter when done");
}

export function jsonOutput(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function errorOutput(error: unknown): void {
  const err = error as { code?: string; message?: string; hint?: string };
  line(fail(`Error${err.code ? ` [${err.code}]` : ""}: ${err.message ?? String(error)}`));
  if (err.hint) line(dim(`  ${err.hint}`));
}
