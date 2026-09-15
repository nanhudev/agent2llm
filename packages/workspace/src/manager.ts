/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
/**
 * Workspace access layer — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/workspace/manager.ts
 *   changes:  opaque workspace ids decoupled from path hashing for the
 *             registry, `.agent2llm.yml` project config, explicit capability
 *             surface, unchanged containment/sensitive-file semantics.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { readJsonIfExists } from "@agent2llm/config";
import { loadWorkspaceConfig, type WorkspaceConfig } from "@agent2llm/config";
import { IgnoreRules } from "./ignore.js";

export type WorkspaceErrorCode =
  | "INVALID_PATH"
  | "PATH_OUTSIDE_WORKSPACE"
  | "ACCESS_DENIED_SENSITIVE_FILE"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "BINARY_FILE"
  | "FILE_TOO_LARGE";

export class WorkspaceError extends Error {
  constructor(
    public code: WorkspaceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
const normCase = (value: string): string => (CASE_INSENSITIVE ? value.toLowerCase() : value);

export interface ReadFileResult {
  path: string;
  sizeBytes: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  remainingLines: number;
  nextStartLine: number | null;
  content: string;
}

export interface DirEntry {
  path: string;
  type: "file" | "dir";
  sizeBytes?: number;
}

export interface ListDirectoryResult {
  path: string;
  entries: DirEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ProjectProfile {
  projectType: string;
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
}

const DEFAULT_MAX_LINES = 400;
const HARD_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 256 * 1024;

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

export class Workspace {
  readonly root: string;
  readonly id: string;
  readonly name: string;
  readonly ignoreRules: IgnoreRules;
  readonly projectConfig: WorkspaceConfig | null;

  constructor(rootInput: string, opts: { id?: string; name?: string } = {}) {
    const resolved = path.resolve(rootInput);
    let real: string;
    try {
      real = fs.realpathSync.native(resolved);
    } catch {
      throw new WorkspaceError("FILE_NOT_FOUND", `Workspace root does not exist: ${rootInput}`);
    }
    if (!fs.statSync(real).isDirectory()) {
      throw new WorkspaceError("NOT_A_DIRECTORY", `Workspace root is not a directory: ${rootInput}`);
    }
    this.root = real;
    this.id = opts.id ?? createHash("sha256").update(normCase(real)).digest("hex").slice(0, 12);
    this.ignoreRules = new IgnoreRules(real);
    this.projectConfig = loadWorkspaceConfig(real);
    this.name = opts.name ?? path.basename(real);
  }

  private contains(candidate: string): boolean {
    const root = normCase(this.root);
    const target = normCase(candidate);
    return target === root || target.startsWith(root + path.sep);
  }

  /** realpath the deepest existing ancestor: defends against symlink escapes. */
  private canonicalize(abs: string): string {
    let current = abs;
    const suffix: string[] = [];
    for (;;) {
      try {
        const real = fs.realpathSync.native(current);
        return suffix.length > 0 ? path.join(real, ...suffix) : real;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return abs;
        suffix.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  resolve(requested: string, opts: { allowSensitive?: boolean } = {}): { abs: string; rel: string } {
    if (typeof requested !== "string" || requested.includes("\0")) {
      throw new WorkspaceError("INVALID_PATH", "Invalid path");
    }
    let p = requested.trim();
    if (p === "" || p === "/") p = ".";
    p = p.replace(/\\/g, "/");
    p = p.replace(/^workspace:\/*/i, "");
    if (p === "") p = ".";

    const abs = path.resolve(this.root, p);
    const canonical = this.canonicalize(abs);
    if (!this.contains(canonical)) {
      throw new WorkspaceError(
        "PATH_OUTSIDE_WORKSPACE",
        `Path resolves outside the connected workspace: ${requested}`
      );
    }
    const rel = path.relative(this.root, canonical).split(path.sep).join("/");
    if (rel.startsWith("..")) {
      throw new WorkspaceError(
        "PATH_OUTSIDE_WORKSPACE",
        `Path resolves outside the connected workspace: ${requested}`
      );
    }
    if (!opts.allowSensitive && rel !== "" && this.ignoreRules.isSensitive(rel)) {
      throw new WorkspaceError(
        "ACCESS_DENIED_SENSITIVE_FILE",
        `ACCESS_DENIED_SENSITIVE_FILE: '${rel}' matches the sensitive-file policy and cannot be read.`
      );
    }
    return { abs: canonical, rel };
  }

  private async isBinary(abs: string): Promise<boolean> {
    const handle = await fs.promises.open(abs, "r");
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      for (let i = 0; i < bytesRead; i++) if (buffer[i] === 0) return true;
      return false;
    } finally {
      await handle.close();
    }
  }

  async readFile(
    requested: string,
    opts: { startLine?: number; endLine?: number; maxLines?: number; maxBytes?: number } = {}
  ): Promise<ReadFileResult> {
    const { abs, rel } = this.resolve(requested);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      throw new WorkspaceError("FILE_NOT_FOUND", `File not found: ${rel}`);
    }
    if (!stat.isFile()) throw new WorkspaceError("NOT_A_FILE", `Not a regular file: ${rel}`);
    if (await this.isBinary(abs)) {
      throw new WorkspaceError("BINARY_FILE", `Binary file (${stat.size} bytes): ${rel}.`);
    }

    const startLine = Math.max(1, Math.floor(opts.startLine ?? 1));
    const maxLines = Math.min(HARD_MAX_LINES, Math.max(1, Math.floor(opts.maxLines ?? DEFAULT_MAX_LINES)));
    const endLimit = opts.endLine
      ? Math.min(Math.floor(opts.endLine), startLine + HARD_MAX_LINES - 1)
      : startLine + maxLines - 1;
    const maxBytes = Math.min(1024 * 1024, Math.max(1024, Math.floor(opts.maxBytes ?? DEFAULT_MAX_BYTES)));

    const lines: string[] = [];
    let totalLines = 0;
    let collectedBytes = 0;
    let byteTruncated = false;
    let actualEnd = startLine - 1;

    const stream = fs.createReadStream(abs, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      totalLines++;
      if (totalLines >= startLine && totalLines <= endLimit && !byteTruncated) {
        const cost = Buffer.byteLength(line, "utf8") + 1;
        if (collectedBytes + cost > maxBytes && lines.length > 0) {
          byteTruncated = true;
        } else {
          lines.push(line);
          collectedBytes += cost;
          actualEnd = totalLines;
        }
      }
    }
    rl.close();

    const remaining = Math.max(0, totalLines - actualEnd);
    return {
      path: rel,
      sizeBytes: stat.size,
      totalLines,
      startLine: Math.min(startLine, Math.max(totalLines, 1)),
      endLine: actualEnd,
      truncated: remaining > 0,
      remainingLines: remaining,
      nextStartLine: remaining > 0 ? actualEnd + 1 : null,
      content: lines.join("\n"),
    };
  }

  async listDirectory(
    requested: string,
    opts: { depth?: number; limit?: number; offset?: number } = {}
  ): Promise<ListDirectoryResult> {
    const { abs, rel } = this.resolve(requested);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      throw new WorkspaceError("FILE_NOT_FOUND", `Directory not found: ${rel || "."}`);
    }
    if (!stat.isDirectory()) throw new WorkspaceError("NOT_A_DIRECTORY", `Not a directory: ${rel}`);
    const depth = Math.min(4, Math.max(1, Math.floor(opts.depth ?? 1)));
    const limit = Math.min(1000, Math.max(1, Math.floor(opts.limit ?? 200)));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));

    const all: DirEntry[] = [];
    const walk = async (dirAbs: string, dirRel: string, level: number): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name);
      });
      for (const entry of entries) {
        const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (this.ignoreRules.isHidden(childRel) || this.ignoreRules.isHidden(`${childRel}/`)) continue;
        if (entry.isDirectory()) {
          all.push({ path: `${childRel}/`, type: "dir" });
          if (level < depth) await walk(path.join(dirAbs, entry.name), childRel, level + 1);
        } else if (entry.isFile()) {
          let size: number | undefined;
          try {
            size = (await fs.promises.stat(path.join(dirAbs, entry.name))).size;
          } catch {
            size = undefined;
          }
          all.push({ path: childRel, type: "file", ...(size !== undefined ? { sizeBytes: size } : {}) });
        }
        if (all.length >= offset + limit + 2000) return;
      }
    };
    await walk(abs, rel, 1);

    const page = all.slice(offset, offset + limit);
    return {
      path: rel || ".",
      entries: page,
      total: all.length,
      offset,
      limit,
      hasMore: offset + page.length < all.length,
    };
  }

  detectProject(): ProjectProfile {
    const has = (file: string): boolean => fs.existsSync(path.join(this.root, file));
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    let projectType = "unknown";
    let packageManager: string | null = null;
    let scripts: Record<string, string> = {};

    if (has("package.json")) {
      projectType = "node";
      languages.add("JavaScript");
      const raw = readJsonIfExists<Record<string, unknown>>(path.join(this.root, "package.json")) ?? {};
      scripts = stringRecord(raw.scripts);
      const deps = { ...stringRecord(raw.dependencies), ...stringRecord(raw.devDependencies) };
      const known: Record<string, string> = {
        next: "Next.js",
        react: "React",
        vue: "Vue",
        svelte: "Svelte",
        express: "Express",
        fastify: "Fastify",
        "@nestjs/core": "NestJS",
        electron: "Electron",
        vitest: "Vitest",
        jest: "Jest",
      };
      for (const [dep, label] of Object.entries(known)) if (deps[dep]) frameworks.add(label);
      if (has("pnpm-lock.yaml")) packageManager = "pnpm";
      else if (has("yarn.lock")) packageManager = "yarn";
      else if (has("bun.lockb") || has("bun.lock")) packageManager = "bun";
      else if (has("package-lock.json")) packageManager = "npm";
    }
    if (has("tsconfig.json")) languages.add("TypeScript");
    if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
      languages.add("Python");
      if (projectType === "unknown") projectType = "python";
    }
    if (has("Cargo.toml")) {
      languages.add("Rust");
      if (projectType === "unknown") projectType = "rust";
    }
    if (has("go.mod")) {
      languages.add("Go");
      if (projectType === "unknown") projectType = "go";
    }
    if (has("Package.swift")) {
      languages.add("Swift");
      if (projectType === "unknown") projectType = "swift";
    }
    return { projectType, languages: [...languages], frameworks: [...frameworks], packageManager, scripts };
  }
}
