import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { transportFailure, timeoutError } from "@agent2llm/core";

/**
 * Subprocess transport shared by every CLI-driven Harness adapter.
 *
 * Deliberately dumb: it does not know what `codex`, `dsh` or `cursor-agent`
 * mean. It streams lines, emits them as events and reports the exit status.
 * Flag construction stays in the adapter that owns the product knowledge.
 */
export interface RunOptions {
  bin: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** stdin payload; omit to leave stdin closed. */
  stdin?: string;
}

export interface RunEvent {
  stream: "stdout" | "stderr";
  line: string;
}

export interface RunOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface RunningProcess {
  events(): AsyncIterable<RunEvent>;
  outcome(): Promise<RunOutcome>;
  cancel(): void;
  child: ChildProcess;
}

const DEFAULT_TIMEOUT = 30 * 60 * 1000;

export function runProcess(options: RunOptions): RunningProcess {
  const started = Date.now();
  let child: ChildProcess;
  try {
    child = spawn(options.bin, [...options.args], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...(options.env ?? {}) },
    });
  } catch (error) {
    throw transportFailure(`Failed to start ${options.bin}: ${(error as Error).message}`, {
      cause: error,
      details: { bin: options.bin, args: options.args },
    });
  }

  const emitter = new EventEmitter();
  const queue: RunEvent[] = [];
  let closed = false;
  let timedOut = false;
  let stdout = "";
  let stderr = "";

  const push = (stream: RunEvent["stream"], chunk: Buffer | string): void => {
    const text = chunk.toString("utf8");
    if (stream === "stdout") stdout += text;
    else stderr += text;
    for (const line of text.split(/\r?\n/)) {
      if (line === "") continue;
      const event: RunEvent = { stream, line };
      queue.push(event);
      emitter.emit("event", event);
    }
  };

  child.stdout?.on("data", (chunk: Buffer) => push("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => push("stderr", chunk));

  let done: (value: RunOutcome) => void;
  const finished = new Promise<RunOutcome>((resolve) => {
    done = resolve;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT);

  function cancel(): void {
    if (closed) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }

  options.signal?.addEventListener("abort", () => cancel(), { once: true });

  const finish = (exitCode: number | null, signal: string | null): void => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    emitter.emit("closed");
    done({
      exitCode,
      signal,
      timedOut,
      durationMs: Date.now() - started,
      stdout,
      stderr,
    });
  };

  child.on("error", (error: Error) => {
    stderr += `\n${error.message}`;
    finish(null, null);
  });
  child.on("close", (code, signal) => finish(code, signal));

  if (options.stdin !== undefined) {
    child.stdin?.end(options.stdin);
  } else {
    child.stdin?.end();
  }

  async function* events(): AsyncIterable<RunEvent> {
    let cursor = 0;
    for (;;) {
      while (cursor < queue.length) yield queue[cursor++]!;
      if (closed) {
        while (cursor < queue.length) yield queue[cursor++]!;
        return;
      }
      await new Promise<void>((resolve) => {
        const onEvent = (): void => {
          emitter.off("event", onEvent);
          emitter.off("closed", onClosed);
          resolve();
        };
        const onClosed = (): void => {
          emitter.off("event", onEvent);
          emitter.off("closed", onClosed);
          resolve();
        };
        emitter.once("event", onEvent);
        emitter.once("closed", onClosed);
      });
    }
  }

  return {
    events,
    outcome: () => finished,
    cancel,
    child,
  };
}

/** Convenience wrapper used by `detect` and capability probing. */
export async function runForOutput(
  options: Omit<RunOptions, "timeoutMs"> & { timeoutMs?: number }
): Promise<{ ok: boolean; output: string; exitCode: number | null; timedOut: boolean }> {
  const proc = runProcess({ ...options, timeoutMs: options.timeoutMs ?? 15_000 });
  const outcome = await proc.outcome();
  if (outcome.timedOut) {
    throw timeoutError(`${options.bin} did not finish within ${options.timeoutMs ?? 15_000}ms.`);
  }
  return {
    ok: outcome.exitCode === 0,
    output: `${outcome.stdout}\n${outcome.stderr}`.trim(),
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
  };
}

/** Best-effort `--help` probe used to avoid inventing CLI flags. */
export async function readHelp(bin: string, extraArgs: readonly string[] = []): Promise<string | null> {
  for (const args of [["--help", ...extraArgs], ["-h", ...extraArgs]]) {
    try {
      const result = await runForOutput({ bin, args: [...args], cwd: process.cwd(), timeoutMs: 12_000 });
      if (result.output.trim() !== "") return result.output;
    } catch {
      // try next form
    }
  }
  return null;
}

/** True when `flag` appears as a standalone token in `--help` output. */
export function helpMentions(help: string | null, flag: string): boolean {
  if (!help) return false;
  return new RegExp(`(^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$|[=,])`).test(help);
}
