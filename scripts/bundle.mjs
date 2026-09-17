#!/usr/bin/env node
/**
 * Bundle the CLI into a single publishable file.
 *
 * The 37 internal packages collapse into one ESM file. Third-party runtime
 * dependencies (zod, express, the MCP SDK) stay external and land in the
 * published package.json as dependencies: npm installs them at their own
 * versions, which keeps the supply chain auditable and avoids bundling CJS
 * packages (express & friends) into an ESM bundle, where their dynamic
 * `require()` of node builtins does not survive. `playwright` is probed at
 * runtime and the CLI degrades to the manual transport without it, so it
 * ships as an optionalDependency.
 */
import { build } from "esbuild";
import { rm, stat } from "node:fs/promises";

const OUT = "dist/agent2llm.mjs";

// Clear the one file this script writes instead of removing the directory.
// esbuild emits exactly one output here, so a recursive delete of `dist` buys
// nothing — and it is refused outright on machines that will not grant it
// (a handle held inside the tree, or a sandbox that declines bulk deletes),
// which used to fail the whole bundle over leftover output that was about to
// be overwritten anyway.
await rm(OUT, { force: true });

const result = await build({
  entryPoints: ["apps/cli/dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: OUT,
  external: [
    "playwright",
    "playwright-core",
    "zod",
    "express",
    "ignore",
    "@modelcontextprotocol/sdk",
    // Subpath imports (`.../server/mcp.js`) are not covered by the bare name.
    "@modelcontextprotocol/sdk/*",
  ],
  // No banner: esbuild keeps the entry point's own shebang on line 1.
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  metafile: true,
  logLevel: "info",
});

if (!result.metafile) {
  throw new Error("esbuild returned no metafile");
}

const size = await stat(OUT);
console.log(`${OUT}: ${(size.size / 1024).toFixed(0)} KiB`);
