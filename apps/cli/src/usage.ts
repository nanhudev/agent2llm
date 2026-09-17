/**
 * The text a user reads when they ask for help.
 *
 * Split out of `index.ts` so that the dispatch table stays readable as a table
 * — this file is prose, and it grows every time a flag is added, while the
 * switch it used to sit next to should not.
 */
import { CLI_PRIMARY_NAME, PRODUCT_NAME } from "@agent2llm/config";
import * as ui from "./ui.js";

export const BANNER = [
  "",
  `  ${PRODUCT_NAME}`,
  "",
  "  Your best model thinks.",
  "  Your favorite agent builds.",
  "",
].join("\n");

export function usage(): void {
  ui.line(BANNER);
  ui.line(ui.bold("  Usage"));
  ui.line(`    ${CLI_PRIMARY_NAME}                       interactive launcher`);
  ui.line(ui.bold("    Relay Mode (one conversation, many goals)"));
  ui.line(`    ${CLI_PRIMARY_NAME} pair create --brain X --harness Y [--workspace DIR]`);
  ui.line(ui.dim("      [--label NAME] [--context-mode harness-owned|a2l-workspace|none]"));
  ui.line(`    ${CLI_PRIMARY_NAME} pair list|show|remove [id]`);
  ui.line(`    ${CLI_PRIMARY_NAME} run "goal" [--pair ID] [--workspace DIR] [--max-iterations N]`);
  ui.line(ui.dim("      Relay uses the brain and harness of a stored pair, so no --brain/--harness"));
  ui.line(ui.dim("      is needed. The harness owns the context: if it reports an open project,"));
  ui.line(ui.dim("      --workspace is not asked for."));
  ui.line(`    ${CLI_PRIMARY_NAME} dock [--port N] [--workspace DIR]`);
  ui.line(ui.dim("      A local page listing your pairs, with a goal box for each. Loopback"));
  ui.line(ui.dim("      only, one-time token, and it never moves another app's window."));
  ui.line(ui.bold("    Brain / Hands (the original workflow)"));
  ui.line(`    ${CLI_PRIMARY_NAME} run --brain X --harness Y [--goal G] [--endpoint URL]`);
  ui.line(ui.dim("      [--ignore-auth] [--dry-run] [--max-iterations N] [--session ID]"));
  ui.line(ui.bold("    Everything else"));
  ui.line(`    ${CLI_PRIMARY_NAME} setup [--brain X] [--harness Y] [--tunnel]`);
  ui.line(`    ${CLI_PRIMARY_NAME} detect [--json] [--quick]`);
  ui.line(`    ${CLI_PRIMARY_NAME} doctor [--json]`);
  ui.line(`    ${CLI_PRIMARY_NAME} adapters|brains|harnesses [--json] [--quick]`);
  ui.line(`    ${CLI_PRIMARY_NAME} session list|show|resume|stop [id]`);
  ui.line(`    ${CLI_PRIMARY_NAME} workspace list|add|remove [path|id]`);
  ui.line(`    ${CLI_PRIMARY_NAME} bridge pair <workspace> | bridge unpair [workspace]`);
  ui.line(ui.dim("      Device pairing with the bridge — a different 'pair' from the one above."));
  ui.line(ui.dim(`      (The old ${CLI_PRIMARY_NAME} pair <workspace> / unpair spelling still works, deprecated.)`));
  ui.line(`    ${CLI_PRIMARY_NAME} logs [--json] [--lines N]`);
  ui.line(`    ${CLI_PRIMARY_NAME} report [--json]`);
  ui.line(`    ${CLI_PRIMARY_NAME} config [--json] | config set <key> <value>`);
  ui.line(`    ${CLI_PRIMARY_NAME} version`);
  ui.line();
  ui.line(ui.dim("  Global flags: --json  --verbose  --debug  --help"));
  ui.line();
  ui.line(ui.dim("  Web Brains attach to a window you already have open when one exposes"));
  ui.line(ui.dim("  a DevTools port (--endpoint, or AGENT2LLM_ATTACH_ENDPOINT); otherwise"));
  ui.line(ui.dim("  they launch their own browser, and fall back to manual last."));
  ui.line(ui.dim("  --ignore-auth runs even when an adapter measured that it is not signed in."));
  ui.line(ui.dim("  --quick skips the version and help probes. Detection is thorough by default,"));
  ui.line(ui.dim("  because reporting a gap as `unknown` beats reporting a guess as a fact."));
  ui.line();
}
