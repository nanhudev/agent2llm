import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

/**
 * Binary discovery.
 *
 * Deliberately bounded: PATH, a short list of well-known install locations,
 * and per-adapter candidate paths. There is no recursive disk scan — that
 * would make `agent2llm detect` unusably slow.
 */
export type BinarySource = "path" | "candidate" | "common" | "explicit";

export interface BinaryLocation {
  name: string;
  path: string;
  source: BinarySource;
  version: string | null;
}

const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat", ".ps1"];

/**
 * Output that is a complaint, not an answer.
 *
 * `shell: true` on Windows runs through `cmd.exe`, which answers a missing or
 * unrunnable target in the console's language — `'x' is not recognized as an
 * internal or external command`, localized, sometimes with mojibake. Taking
 * the first line of that put an error message in the VERSION column of
 * `agent2llm adapters`, which is worse than an honest `unknown`: it looks like
 * data. Only a short, single-token-ish line that is not obviously an error is
 * accepted as a version.
 */
function looksLikeDiagnostic(text: string): boolean {
  if (text.length > 80) return true;
  if (/[\\/]/.test(text) && /\s/.test(text)) return true; // a path inside a sentence
  return /not recognized|not found|no such file|cannot find|is not|не является|不是内部|找不到|不是可运行|command not/i.test(
    text
  );
}

function pathDirectories(): string[] {
  const raw = process.env.PATH ?? "";
  return raw
    .split(path.delimiter)
    .map((entry) => entry.replace(/^"|"$/g, "").trim())
    .filter((entry) => entry !== "");
}

function executableCandidates(dir: string, name: string): string[] {
  const base = path.join(dir, name);
  if (process.platform !== "win32") return [base];
  const withExtensions = WINDOWS_EXTENSIONS.map((ext) => base + ext);
  return [base, ...withExtensions];
}

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    // eslint-disable-next-line no-bitwise
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function findInPath(name: string): string | null {
  for (const dir of pathDirectories()) {
    for (const candidate of executableCandidates(dir, name)) {
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function commonDirectories(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      return [
        path.join(localAppData, "Programs"),
        path.join(appData, "npm"),
        path.join(home, ".local", "bin"),
      ];
    }
    case "darwin":
      return ["/usr/local/bin", "/opt/homebrew/bin", path.join(home, ".local", "bin"), "/Applications"];
    default:
      return ["/usr/local/bin", "/usr/bin", path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin")];
  }
}

/**
 * Version probe: `--version`, then `-V`, then `version`. Never throws.
 *
 * On Windows a POSIX shim (`#!/bin/sh`, which is what npm writes for every
 * global package) cannot be spawned directly — `spawn` reports ENOENT, not
 * EACCES, so the probe looks like "this binary has no version" when the real
 * story is "this file needs a shell". Since `npm install -g` is the most
 * common way to get these tools, that would leave most harnesses reporting
 * `version: unknown` on the platform most of this project's users run.
 *
 * So a failed direct spawn falls back to `shell: true`, which lets the OS
 * resolve the shim. The fallback is attempted only when the direct spawn
 * produced nothing, so genuinely executable binaries pay no extra cost.
 */
export function readVersion(binPath: string, timeoutMs = 8000): Promise<string | null> {
  const attempts: string[][] = [["--version"], ["-V"], ["version"]];

  const spawnOnce = (
    command: string,
    args: string[],
    useShell: boolean
  ): Promise<string | null> =>
    new Promise((resolve) => {
      try {
        const child = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          ...(useShell ? { shell: true } : {}),
        });
        let output = "";
        // A failed spawn must settle the promise, and `shell: true` changes
        // which event arrives first, so both paths funnel through one guard.
        let settled = false;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(null);
        }, timeoutMs);
        child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.on("error", () => finish(null));
        child.on("close", () => {
          const first = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
          if (first === "" || looksLikeDiagnostic(first)) return finish(null);
          finish(first.slice(0, 120));
        });
      } catch {
        resolve(null);
      }
    });

  /**
   * How to actually run this file, which is not always "run it directly".
   *
   * Direct first. Then, on Windows only, the file's own shebang interpreter:
   * `npm install -g` writes a POSIX `#!/bin/sh` shim, and Windows has no
   * loader for that. `sh` on PATH (Git for Windows, which most Windows
   * developers already have) runs it the way the shim expects. When there is
   * no usable shebang, the `.cmd` sibling npm also writes is the last resort.
   */
  const invocations = (args: string[]): { command: string; args: string[]; shell: boolean }[] => {
    const direct = [{ command: binPath, args, shell: false }];
    if (process.platform !== "win32") return direct;
    const invocations: { command: string; args: string[]; shell: boolean }[] = [...direct];
    const shebang = readShebang(binPath);
    if (shebang) invocations.push({ command: shebang, args: [binPath, ...args], shell: false });
    const cmdShim = `${binPath}.cmd`;
    if (fs.existsSync(cmdShim)) invocations.push({ command: cmdShim, args, shell: false });
    return invocations;
  };

  const run = async (args: string[]): Promise<string | null> => {
    for (const call of invocations(args)) {
      const version = await spawnOnce(call.command, call.args, call.shell);
      if (version) return version;
    }
    return null;
  };

  return (async () => {
    for (const args of attempts) {
      const version = await run(args);
      if (version) return version;
    }
    return null;
  })();
}

/**
 * The `#!` interpreter of a script, resolved to something runnable here.
 *
 * Two shapes matter. `#!/bin/sh` is the npm POSIX shim; `#!/usr/bin/env node`
 * is what most real CLI scripts (and any locally-run `.js` bin) declare. Both
 * are POSIX paths that Windows cannot execute, but the *interpreter* is a bare
 * program name — `sh`, `node` — which is very often already on PATH. So take
 * the basename of the shebang target, and when it is `env`, take the basename
 * of the argument that follows it instead of giving up.
 */
export function readShebang(file: string): string | null {
  let head: string;
  try {
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(128);
    const read = fs.readSync(fd, buffer, 0, 128, 0);
    fs.closeSync(fd);
    head = buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  }
  const match = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(head);
  if (!match?.[1]) return null;
  let interpreter = path.basename(match[1]);
  if (interpreter === "env") {
    const inner = match[2] ? path.basename(match[2]) : "";
    if (inner === "" || inner.startsWith("-")) return null;
    interpreter = inner;
  }
  if (interpreter === "") return null;
  return findInPath(interpreter);
}

export interface LocateOptions {
  candidates?: readonly string[];
  /**
   * Directories scanned for the newest binary matching `versionedPattern`.
   * Used by products that ship versioned, product-owned binaries.
   */
  versionedDirs?: readonly string[];
  versionedPattern?: RegExp;
  probeVersion?: boolean;
}

export async function locateBinary(name: string, options: LocateOptions = {}): Promise<BinaryLocation | null> {
  const fromPath = findInPath(name);
  if (fromPath) {
    return {
      name,
      path: fromPath,
      source: "path",
      version: options.probeVersion === false ? null : await readVersion(fromPath),
    };
  }

  for (const candidate of options.candidates ?? []) {
    const expanded = candidate.replace(/^~/, os.homedir());
    if (isExecutable(expanded)) {
      return {
        name,
        path: expanded,
        source: "candidate",
        version: options.probeVersion === false ? null : await readVersion(expanded),
      };
    }
  }

  const pattern = options.versionedPattern;
  if (pattern) {
    for (const dir of options.versionedDirs ?? []) {
      const newest = newestInDirectory(dir.replace(/^~/, os.homedir()), pattern);
      if (newest) {
        return {
          name,
          path: newest,
          source: "candidate",
          version: options.probeVersion === false ? null : await readVersion(newest),
        };
      }
    }
  }

  for (const dir of commonDirectories()) {
    for (const candidate of executableCandidates(dir, name)) {
      if (isExecutable(candidate)) {
        return {
          name,
          path: candidate,
          source: "common",
          version: options.probeVersion === false ? null : await readVersion(candidate),
        };
      }
    }
  }

  return null;
}

/**
 * Directories a product uses for its own private binaries.
 *
 * GUI-first agents increasingly ship a managed CLI instead of asking users to
 * `npm install -g` one. Codex Desktop is the canonical case: it stages a full
 * `codex.exe` under `$CODEX_HOME/.sandbox-bin` and deliberately keeps it off
 * PATH, because the binary belongs to the app rather than to the shell.
 *
 * Adapters pass these as `candidates` so discovery still works when the user
 * never installed a standalone CLI.
 */
export function homeDirectories(relativeDirs: readonly string[]): string[] {
  const home = os.homedir();
  return relativeDirs.map((dir) => path.join(home, dir));
}

/**
 * Product-owned binary roots, expanded one level deep.
 *
 * Some of these roots version their children (`codex-command-runner-1.2.3.exe`)
 * so the newest entry is what we want, not a fixed filename.
 */
export function newestInDirectory(dir: string, pattern: RegExp): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((entry) => pattern.test(entry))
    .map((entry) => {
      const full = path.join(dir, entry);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        return null;
      }
      return { full, mtime };
    })
    .filter((entry): entry is { full: string; mtime: number } => entry !== null);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.full ?? null;
}

/** Windows / macOS application bundle hints for GUI-first agents. */
export function bundleCandidates(relativeBinary: string): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return [
        `/Applications/${relativeBinary}`,
        path.join(home, "Applications", relativeBinary),
      ];
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      return [
        path.join(localAppData, "Programs", relativeBinary),
        path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", relativeBinary),
      ];
    }
    default:
      return [path.join(home, ".local", "bin", relativeBinary)];
  }
}
