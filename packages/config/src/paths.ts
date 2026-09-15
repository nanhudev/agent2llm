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
export const PRODUCT_NAME = "Agent2LLM";
export const CLI_NAME = "agent2llm";
export const CLI_ALIAS = "a2l";
