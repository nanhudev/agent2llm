#!/usr/bin/env node
/**
 * Assemble the publishable package.
 *
 * The monorepo root stays a workspace root; the published artifact is
 * assembled in staging/ so its package.json is clean (no workspaces field
 * leaking into installs) and its version comes from the root.
 *
 * Output: agent2llm-<version>.tgz in the repo root, verified installable.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const staging = path.join(root, "staging");

const rootPkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const deps = {
  zod: "^3.25.0",
  express: "^5.2.0",
  ignore: "^7.0.0",
  "@modelcontextprotocol/sdk": "^1.20.0",
};

const pkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: "Your best model thinks. Your favorite agent builds. Mix any AI reasoning client with any coding harness.",
  license: "MIT",
  type: "module",
  engines: { node: ">=20" },
  bin: {
    agent2llm: "dist/agent2llm.mjs",
    a2l: "dist/agent2llm.mjs",
  },
  files: ["dist", "AGENTS.md", "scripts/postinstall.mjs"],
  dependencies: deps,
  optionalDependencies: {
    playwright: "^1.63.0",
  },
  scripts: {
    // One double-click after install: the postinstall puts an icon on the
    // desktop (global installs only; CI and AGENT2LLM_NO_SHORTCUT=1 skip it,
    // and it never fails the install). The command itself is the tested
    // `a2l dock shortcut`, not a reimplementation.
    postinstall: "node scripts/postinstall.mjs",
  },
  keywords: [
    "ai",
    "agent",
    "llm",
    "cli",
    "mcp",
    "codex",
    "cursor",
    "claude",
    "chatgpt",
    "orchestration",
    "developer-tools",
  ],
  repository: {
    type: "git",
    url: "git+https://github.com/nanhudev/agent2llm.git",
  },
  bugs: { url: "https://github.com/nanhudev/agent2llm/issues" },
  homepage: "https://github.com/nanhudev/agent2llm#readme",
};

// Clear exactly the files this script writes, one path at a time, rather than
// removing the whole staging directory. The contents are known, so enumerating
// them is not a compromise: it removes any chance of a stale file surviving
// (an unlinked directory can leave one behind when the delete is refused), and
// it does not need a recursive delete, which some machines decline to grant.
const STAGING_FILES = [
  "package.json",
  path.join("dist", "agent2llm.mjs"),
  path.join("scripts", "postinstall.mjs"),
  "README.md",
  "LICENSE",
  "AGENTS.md",
];
for (const rel of STAGING_FILES) {
  await rm(path.join(staging, rel), { force: true });
}
await mkdir(path.join(staging, "dist"), { recursive: true });
await mkdir(path.join(staging, "scripts"), { recursive: true });

await writeFile(path.join(staging, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
await cp(path.join(root, "dist", "agent2llm.mjs"), path.join(staging, "dist", "agent2llm.mjs"));
await cp(path.join(root, "scripts", "postinstall.mjs"), path.join(staging, "scripts", "postinstall.mjs"));
await cp(path.join(root, "docs", "pack-readme.md"), path.join(staging, "README.md"));
await cp(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
await cp(path.join(root, "AGENTS.md"), path.join(staging, "AGENTS.md"));

const tgzName = `${pkg.name}-${pkg.version}.tgz`;
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
// Run inside staging/: from the workspace root, `npm pack staging` resolves
// `staging` against the registry (a package by that name exists there)
// instead of the local directory.
execFileSync(npmBin, ["pack", "--pack-destination", root], {
  stdio: "inherit",
  cwd: staging,
  shell: process.platform === "win32",
});

console.log(`\nassembled: ${tgzName}`);
console.log("install check:  npm i -g ./" + tgzName);
