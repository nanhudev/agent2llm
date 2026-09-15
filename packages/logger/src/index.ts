/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir } from "@agent2llm/config";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

const LEVELS: Record<LogLevel, number> = { error: 10, warn: 20, info: 30, debug: 40, trace: 50 };

/**
 * Secret redaction. Adapted from C2C: logs must never contain tokens,
 * pairing codes, authorization headers or credentials.
 */
const REDACT_PATTERNS: RegExp[] = [
  /a2l_(?:at|rt|ac|admin|pk)_[A-Za-z0-9_-]+/g,
  /c2c_(?:at|rt|ac|admin)_[A-Za-z0-9_-]+/g,
  /(authorization"?\s*[:=]\s*"?bearer\s+)[^\s"']+/gi,
  /((?:access_token|refresh_token|client_secret|code_verifier|api[_-]?key|token)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g, // pairing-code shaped
  /(sk-[A-Za-z0-9-]{16,})/g,
];

export function redact(input: string): string {
  let out = input;
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, (_match, group1) =>
      typeof group1 === "string" ? `${group1}[REDACTED]` : "[REDACTED]"
    );
  }
  return out;
}

export interface LoggerOptions {
  name?: string;
  level?: LogLevel;
  file?: string | null;
  console?: boolean;
}

export class Logger {
  private level: number;
  private file: string | null;
  private useConsole: boolean;
  readonly name: string;

  constructor(opts: LoggerOptions = {}) {
    this.name = opts.name ?? "agent2llm";
    const env = process.env.AGENT2LLM_LOG_LEVEL as LogLevel | undefined;
    this.level = LEVELS[opts.level ?? env ?? "info"] ?? LEVELS.info;
    this.useConsole = opts.console ?? false;
    this.file =
      opts.file === undefined
        ? path.join(ensureDir(path.join(getStateDir(), "logs")), `${this.name}.log`)
        : opts.file;
  }

  child(name: string): Logger {
    return new Logger({ name: `${this.name}:${name}`, level: this.levelName(), console: this.useConsole, file: this.file });
  }

  levelName(): LogLevel {
    for (const [name, value] of Object.entries(LEVELS)) {
      if (value === this.level) return name as LogLevel;
    }
    return "info";
  }

  private write(level: LogLevel, message: string, extra?: unknown): void {
    if (LEVELS[level] > this.level) return;
    const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${this.name}]`, redact(message)];
    if (extra !== undefined) {
      try {
        parts.push(redact(JSON.stringify(extra)));
      } catch {
        parts.push("[unserializable]");
      }
    }
    const line = `${parts.join(" ")}\n`;
    if (this.file) {
      try {
        fs.appendFileSync(this.file, line, { mode: 0o600 });
      } catch {
        // logging must never crash the process
      }
    }
    if (this.useConsole) process.stderr.write(line);
  }

  error(message: string, extra?: unknown): void {
    this.write("error", message, extra);
  }
  warn(message: string, extra?: unknown): void {
    this.write("warn", message, extra);
  }
  info(message: string, extra?: unknown): void {
    this.write("info", message, extra);
  }
  debug(message: string, extra?: unknown): void {
    this.write("debug", message, extra);
  }
  trace(message: string, extra?: unknown): void {
    this.write("trace", message, extra);
  }
}

export const nullLogger = new Logger({ file: null, console: false, level: "error" });
