import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * OS-convention state directory. Override with AGENT2LLM_STATE_DIR
 * (used heavily by tests, and by users who keep their C: drive clean).
 */
export function getStateDir(): string {
  const override = process.env.AGENT2LLM_STATE_DIR;
  if (override && override.trim() !== "") return path.resolve(override.trim());
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "agent2llm");
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
        "agent2llm"
      );
    default: {
      const base = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
      return path.join(base, "agent2llm");
    }
  }
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function stateSubdir(name: string): string {
  return ensureDir(path.join(getStateDir(), name));
}

export function stateFile(name: string, file: string): string {
  return path.join(stateSubdir(name), file);
}

/** Write JSON with owner-only permissions. */
export function writeSecureJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort on platforms without POSIX permissions
  }
}

export function readJsonIfExists<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function removeIfExists(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ignore
  }
}

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 47621;

/**
 * Product identity, in one place.
 *
 * A future brand rename edits these constants and nothing else in code — no
 * hunting through files that print a name. Three things a rename must NOT
 * touch, because they are compatibility surfaces others may already depend on:
 * the `a2l/1` protocol string, the `a2l`-prefixed persisted identifiers
 * (sessions, pairs, runs), and the state directory layout.
 */
export const PRODUCT_NAME = "Agent2LLM";
/** The short human-facing form of the product name, for prose and tight UI. */
export const PRODUCT_SHORT_NAME = "A2L";
/** The command users are told to type. The legacy names keep working as bins. */
export const CLI_PRIMARY_NAME = "a2l";
/** Binaries that still resolve but are no longer the recommended spelling. */
export const LEGACY_NAMES: readonly string[] = ["agent2llm"];

/**
 * The full-name binary. Superseded by {@link CLI_PRIMARY_NAME} for anything a
 * user reads; kept so `version` can report which binary is actually running.
 */
export const CLI_NAME = LEGACY_NAMES[0];
/** Kept for existing imports; the primary spelling is {@link CLI_PRIMARY_NAME}. */
export const CLI_ALIAS = CLI_PRIMARY_NAME;

/**
 * What the CLI reports as its version.
 *
 * Kept beside the name so the two cannot drift, and separate from
 * `DEFAULT_HOST`/`DEFAULT_PORT` so a later change to those cannot silently move
 * the dock off loopback.
 */
export const CLI_VERSION = "0.2.0";
