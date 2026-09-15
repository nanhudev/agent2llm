/**
 * Workspace search: ripgrep when available, bounded Node fallback otherwise.
 * Both engines pass through the same ignore/sensitive policy, so a missing
 * ripgrep binary downgrades performance, never security.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findInPath } from "@agent2llm/detect";
import type { Workspace } from "./manager.js";

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  matchCount: number;
  truncated: boolean;
  engine: "ripgrep" | "node";
}

export interface SearchOptions {
  query: string;
  path?: string;
  glob?: string;
  limit?: number;
  regex?: boolean;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MATCHES_HARD = 500;

function ripgrepArgs(options: SearchOptions): string[] {
  const args = [
    "--line-number",
    "--no-heading",
    "--color=never",
    "--hidden",
    "--max-filesize=2M",
    ...(options.regex === true ? [] : ["--fixed-strings"]),
    ...(options.glob ? ["--glob", options.glob] : []),
    "--",
    options.query,
  ];
  return args;
}

function runRipgrep(root: string, options: SearchOptions, limit: number): Promise<SearchMatch[] | null> {
  const binary = findInPath("rg");
  if (!binary) return Promise.resolve(null);
  return new Promise((resolve) => {
    const matches: SearchMatch[] = [];
    const child = spawn(binary, ripgrepArgs(options), {
      cwd: options.path ? path.join(root, options.path) : root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve(matches);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!match) continue;
        matches.push({ path: match[1]!.split(path.sep).join("/"), line: Number(match[2]), text: match[3]!.slice(0, 500) });
        if (matches.length >= limit) {
          child.kill();
          clearTimeout(timer);
          finish();
          return;
        }
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function nodeSearch(workspace: Workspace, options: SearchOptions, limit: number): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const needle = options.query;
  const isRegex = options.regex === true;
  const pattern = isRegex ? new RegExp(needle) : null;
  const roots: string[] = [options.path ?? "."];
  const queue: { abs: string; rel: string; depth: number }[] = roots.map((rel) => ({
    abs: path.join(workspace.root, rel),
    rel: rel === "." ? "" : rel,
    depth: 0,
  }));

  while (queue.length > 0 && matches.length < limit) {
    const current = queue.shift()!;
    if (current.depth > 6) continue;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      if (workspace.ignoreRules.isHidden(childRel)) continue;
      if (entry.isDirectory()) {
        queue.push({ abs: path.join(current.abs, entry.name), rel: childRel, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (options.glob && !matchGlob(entry.name, options.glob)) continue;
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(path.join(current.abs, entry.name));
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content: string;
      try {
        content = await fs.promises.readFile(path.join(current.abs, entry.name), "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const text = lines[index] ?? "";
        const hit = pattern ? pattern.test(text) : text.includes(needle);
        if (!hit) continue;
        matches.push({ path: childRel, line: index + 1, text: text.slice(0, 500) });
        if (matches.length >= limit) break;
      }
    }
  }
  return matches;
}

function matchGlob(name: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(name);
}

export async function searchWorkspace(workspace: Workspace, options: SearchOptions): Promise<SearchResult> {
  const limit = Math.min(MAX_MATCHES_HARD, Math.max(1, Math.floor(options.limit ?? 50)));
  if (options.path) {
    // containment check: a bad path must fail loudly, not silently search everything
    workspace.resolve(options.path);
  }
  const rg = await runRipgrep(workspace.root, options, limit);
  if (rg) {
    const allowed = rg.filter((match) => !workspace.ignoreRules.isHidden(match.path));
    return {
      matches: allowed.slice(0, limit),
      matchCount: allowed.length,
      truncated: allowed.length > limit,
      engine: "ripgrep",
    };
  }
  const matches = await nodeSearch(workspace, options, limit);
  return { matches, matchCount: matches.length, truncated: matches.length >= limit, engine: "node" };
}
