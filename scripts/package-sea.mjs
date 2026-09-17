#!/usr/bin/env node
/**
 * Package the CLI as a single self-contained executable via Node SEA
 * (Single Executable Application).
 *
 * Why a second bundle: SEA embeds exactly one CommonJS script into a Node
 * binary. The published bundle (scripts/bundle.mjs) is ESM on purpose —
 * zod, express, ignore and the MCP SDK stay external so npm keeps auditing
 * them at their own versions. An executable has no node_modules beside it,
 * so those packages must be bundled here. That only survives as CJS output
 * (the same reason scripts/bundle.mjs refuses to bundle them into ESM),
 * hence format: "cjs".
 *
 * playwright stays external in both bundles: it is a lazy, optional import
 * whose absence already degrades to the manual transport with an actionable
 * message, and bundling it would drag in playwright-core, which expects a
 * browsers.json on disk that an executable cannot carry.
 *
 * The blob and the copied binary MUST come from the same Node build — a SEA
 * blob refuses to run inside a Node binary of a different version — so both
 * go through process.execPath instead of whatever `node` happens to be first
 * on PATH.
 *
 * Output: dist/sea/agent2llm.exe on Windows, dist/sea/agent2llm elsewhere.
 * Run `npm run build` first: the SEA bundle starts from apps/cli/dist/index.js.
 *
 * Honesty notes that belong in release text, not marketing:
 * - The Windows binary is not code-signed, so SmartScreen will warn on first
 *   run ("More info" -> "Run anyway").
 * - The macOS binary is ad-hoc signed, so Gatekeeper will ask for a right
 *   click -> Open the first time. DMG assembly (hdiutil) happens in CI; this
 *   script only produces the raw binary on whichever OS runs it.
 */
import { build } from "esbuild";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SEA_DIR = path.join(root, "dist", "sea");
const CJS_OUT = path.join(SEA_DIR, "agent2llm.cjs");
const BLOB = path.join(SEA_DIR, "sea-prep.blob");
const CONFIG = path.join(SEA_DIR, "sea-config.json");
const EXE = path.join(SEA_DIR, process.platform === "win32" ? "agent2llm.exe" : "agent2llm");
const ENTRY = path.join(root, "apps", "cli", "dist", "index.js");

// The sentinel fuse value is fixed by the Node SEA documentation; postject
// flips it from "not prepared" to "prepared" when the blob is injected.
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

try {
  // Fail with the actionable message, not esbuild's resolver error.
  await stat(ENTRY);
} catch {
  console.error("apps/cli/dist/index.js is missing. Run `npm run build` first.");
  process.exit(1);
}

await mkdir(SEA_DIR, { recursive: true });
// A stale blob or exe from a previous run would be overwritten anyway, but a
// stale sea-config.json could point at an older entry — write everything fresh.
await rm(BLOB, { force: true });
await rm(EXE, { force: true });

console.log("[1/4] Bundling a self-contained CommonJS script for SEA...");
await build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: CJS_OUT,
  external: ["playwright", "playwright-core"],
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  logLevel: "info",
});

console.log("[2/4] Generating the SEA blob...");
// Observed on Node 22: the paths inside sea-config.json resolve against the
// process cwd, not against the config file's own directory — keep them
// relative to the repo root and run the generator with cwd = root.
await writeFile(
  CONFIG,
  JSON.stringify(
    {
      main: "dist/sea/agent2llm.cjs",
      output: "dist/sea/sea-prep.blob",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2
  ) + "\n"
);
run(process.execPath, ["--experimental-sea-config", CONFIG], { cwd: root });

console.log("[3/4] Copying the Node binary...");
await copyFile(process.execPath, EXE);

console.log("[4/4] Injecting the blob (postject)...");
const require = createRequire(import.meta.url);
const postjectCli = require.resolve("postject/dist/cli.js", { paths: [root] });
if (process.platform === "darwin") {
  // macOS: the copied binary carries an ad-hoc signature that becomes invalid
  // the moment we modify it. Strip it before injection, re-sign after.
  spawnSync("codesign", ["--remove-signature", EXE], { stdio: "inherit" });
  run(process.execPath, [
    postjectCli,
    EXE,
    "NODE_SEA_BLOB",
    BLOB,
    "--sentinel-fuse",
    SENTINEL_FUSE,
    "--macho-segment-name",
    "NODE_SEA",
    "--overwrite",
  ]);
  run("codesign", ["--sign", "-", EXE]);
} else {
  run(process.execPath, [
    postjectCli,
    EXE,
    "NODE_SEA_BLOB",
    BLOB,
    "--sentinel-fuse",
    SENTINEL_FUSE,
    "--overwrite",
  ]);
}

const size = await stat(EXE);
console.log(`Done: ${EXE} (${(size.size / 1024 / 1024).toFixed(1)} MiB)`);
console.log("Smoke it: " + EXE + " --help");
