#!/usr/bin/env node
/**
 * Best-effort desktop shortcut after a global `npm i -g agent2llm`.
 *
 * Global installs end with an icon on the desktop that starts the dock, so
 * the product is one double-click away instead of one terminal command away.
 * The command doing the work is the CLI's own `a2l dock shortcut` — one
 * implementation, tested once — and this script's only jobs are the gates:
 *
 * - skipped for project-local installs (a node_modules dependency must never
 *   touch the user's desktop),
 * - skipped in CI, where there is no desktop to speak of,
 * - skipped on AGENT2LLM_NO_SHORTCUT=1, the documented opt-out,
 * - and it never fails the install: any error is reported on stderr and the
 *   script exits 0, because a cosmetic failure must not break `npm i -g`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function skip(): string | null {
  if (process.env.AGENT2LLM_NO_SHORTCUT === "1") return "AGENT2LLM_NO_SHORTCUT=1";
  if (process.env.CI === "true" || process.env.CI === "1") return "CI";
  if (process.env.npm_config_global !== "true") return "not a global install";
  return null;
}

const reason = skip();
if (reason) {
  process.exit(0);
}

const cli = path.join(here, "..", "dist", "agent2llm.mjs");
const result = spawnSync(
  process.execPath,
  [cli, "dock", "shortcut", "--json"],
  { encoding: "utf8", timeout: 60000 }
);

if (result.status !== 0) {
  const detail = (result.stderr || result.stdout || "").trim().split("\n").pop() ?? "";
  console.error(`agent2llm: desktop shortcut not created${detail ? ` (${detail})` : ""}. Run 'a2l dock shortcut' to try again.`);
}
process.exit(0);
