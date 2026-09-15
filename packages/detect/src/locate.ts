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

/** Version probe: `--version`, then `-V`, then `version`. Never throws. */
export function readVersion(binPath: string, timeoutMs = 8000): Promise<string | null> {
  const attempts: string[][] = [["--version"], ["-V"], ["version"]];
  const run = (args: string[]): Promise<string | null> =>
    new Promise((resolve) => {
      try {
        const child = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let output = "";
        const timer = setTimeout(() => {
          child.kill();
          resolve(null);
        }, timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.on("error", () => {
          clearTimeout(timer);
          resolve(null);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          const first = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
          resolve(code === 0 && first !== "" ? first.slice(0, 120) : first === "" ? null : first);
        });
      } catch {
        resolve(null);
      }
    });

  return (async () => {
    for (const args of attempts) {
      const version = await run(args);
      if (version) return version;
    }
    return null;
  })();
}

export interface LocateOptions {
  candidates?: readonly string[];
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
