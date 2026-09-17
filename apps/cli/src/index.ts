#!/usr/bin/env node
/**
 * Agent2LLM CLI — `agent2llm` / `a2l`.
 *
 * CLI-first, no GUI. Every command that produces structured information
 * supports --json so other agents can drive Agent2LLM programmatically.
 */
import { CLI_NAME } from "@agent2llm/config";
import { A2LError, isA2LError } from "@agent2llm/core";
import { decideRunMode } from "@agent2llm/pairs";
import * as ui from "./ui.js";
import { createRegistry, registerExternalAdapters, RECOMMENDED_BRAIN_ORDER, RECOMMENDED_HARNESS_ORDER } from "./registry.js";
import { runDetect, runAdapters } from "./commands/detect.js";
import { runDoctor } from "./commands/doctor.js";
import { runRun } from "./commands/run.js";
import { runRelay } from "./commands/relay.js";
import { runPairCreate, runPairList, runPairRemove, runPairShow } from "./commands/pair.js";
import {
  runSessionList,
  runSessionShow,
  runSessionStop,
  runWorkspaceList,
  runWorkspaceAdd,
  runWorkspaceRemove,
  runConfigShow,
} from "./commands/session.js";
import { runSetup, runPair, runUnpair, runLogs, runVersion, runConfigSet } from "./commands/setup.js";
import { runReport } from "./commands/report.js";

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[] | undefined;
}

/**
 * Flags that are switches, so the token after them is never their value.
 *
 * Without this, `a2l run --relay "fix the login bug"` parses as
 * `relay: "fix the login bug"` and the goal vanishes — a boolean flag silently
 * eating the next argument is the kind of bug that looks like the feature not
 * working. `--flag=false` still works, because the `=` form is handled first.
 */
const BOOLEAN_FLAGS = new Set([
  "json",
  "verbose",
  "debug",
  "help",
  "h",
  "quick",
  "tunnel",
  "dry-run",
  "ignore-auth",
  "relay",
]);

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") {
      flags._.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq > -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[index + 1];
        if (next && !next.startsWith("--") && !BOOLEAN_FLAGS.has(body)) {
          flags[body] = next;
          index++;
        } else {
          flags[body] = true;
        }
      }
    } else if (token.startsWith("-") && token.length > 1) {
      flags[token.slice(1)] = true;
    } else {
      flags._.push(token);
    }
  }
  return flags;
}

const str = (value: string | boolean | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
const bool = (value: string | boolean | string[] | undefined): boolean => value === true || value === "true";

const BANNER = [
  "",
  "  Agent2LLM",
  "",
  "  Your best model thinks.",
  "  Your favorite agent builds.",
  "",
].join("\n");

function usage(): void {
  ui.line(BANNER);
  ui.line(ui.bold("  Usage"));
  ui.line(`    ${CLI_NAME}                       interactive launcher`);
  ui.line(ui.bold("    Relay Mode (one conversation, many goals)"));
  ui.line(`    ${CLI_NAME} pair create --brain X --harness Y [--workspace DIR]`);
  ui.line(ui.dim("      [--label NAME] [--context-mode harness-owned|a2l-workspace|none]"));
  ui.line(`    ${CLI_NAME} pair list|show|remove [id]`);
  ui.line(`    ${CLI_NAME} run "goal" [--pair ID] [--workspace DIR] [--max-iterations N]`);
  ui.line(ui.dim("      Relay uses the brain and harness of a stored pair, so no --brain/--harness"));
  ui.line(ui.dim("      is needed. The harness owns the context: if it reports an open project,"));
  ui.line(ui.dim("      --workspace is not asked for."));
  ui.line(ui.bold("    Brain / Hands (the original workflow)"));
  ui.line(`    ${CLI_NAME} run --brain X --harness Y [--goal G] [--endpoint URL]`);
  ui.line(ui.dim("      [--ignore-auth] [--dry-run] [--max-iterations N] [--session ID]"));
  ui.line(ui.bold("    Everything else"));
  ui.line(`    ${CLI_NAME} setup [--brain X] [--harness Y] [--tunnel]`);
  ui.line(`    ${CLI_NAME} detect [--json] [--quick]`);
  ui.line(`    ${CLI_NAME} doctor [--json]`);
  ui.line(`    ${CLI_NAME} adapters|brains|harnesses [--json] [--quick]`);
  ui.line(`    ${CLI_NAME} session list|show|resume|stop [id]`);
  ui.line(`    ${CLI_NAME} workspace list|add|remove [path|id]`);
  ui.line(`    ${CLI_NAME} pair <workspace> | unpair [workspace]`);
  ui.line(ui.dim("      Device pairing with the bridge — a different 'pair' from the one above."));
  ui.line(`    ${CLI_NAME} logs [--json] [--lines N]`);
  ui.line(`    ${CLI_NAME} report [--json]`);
  ui.line(`    ${CLI_NAME} config [--json] | config set <key> <value>`);
  ui.line(`    ${CLI_NAME} version`);
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

async function interactiveLauncher(registry: ReturnType<typeof createRegistry>): Promise<number> {
  ui.line(BANNER);
  // Full probe: the launcher is the one screen a new user sees, and a harness
  // listed as present with no version is what makes people think the install
  // is broken. The launcher runs once, so the probe cost is paid once.
  const detections = await registry.detectAll();
  const byId = new Map(detections.map((d) => [d.id, d]));

  const show = (ids: readonly string[], title: string): void => {
    ui.heading(title);
    for (const id of ids) {
      const found = byId.get(id);
      if (!found) continue;
      const detected = found.detection.status === "detected" || found.detection.status === "verified";
      ui.line(`  ${detected ? ui.MARK_OK : ui.MARK_NO} ${found.name}`);
    }
  };
  show(RECOMMENDED_BRAIN_ORDER.filter((id) => id !== "mock-brain"), "Brains");
  show(RECOMMENDED_HARNESS_ORDER.filter((id) => id !== "mock-harness"), "Harnesses");

  const brain = await ui.promptChoice("Brain", RECOMMENDED_BRAIN_ORDER.filter((id) => byId.has(id)).map((id) => ({
    label: byId.get(id)!.name,
    value: id,
    hint: byId.get(id)!.detection.status,
  })));
  const harness = await ui.promptChoice("Harness", RECOMMENDED_HARNESS_ORDER.filter((id) => byId.has(id)).map((id) => ({
    label: byId.get(id)!.name,
    value: id,
    hint: byId.get(id)!.detection.status,
  })));
  const workflow = await ui.promptChoice("Workflow", [
    { label: "Brain / Hands", value: "brain-hands", hint: "recommended" },
    { label: "Peer", value: "peer" },
    { label: "Planner only", value: "planner-only" },
    { label: "Review only", value: "review-only" },
    { label: "Harness autonomous", value: "harness-autonomous" },
  ]);
  const workspace = await ui.promptText("Workspace", process.cwd());
  const goal = await ui.promptText("Goal");
  if (goal === "") {
    ui.warn("No goal supplied; nothing to do.");
    return 0;
  }
  return runRun(registry, { brain, harness, workflow, workspace, goal });
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const [command, ...rest] = flags._;
  const json = bool(flags.json);
  const verbose = bool(flags.verbose) || bool(flags.debug);

  if (command === "help" || bool(flags.help) || bool(flags.h)) {
    usage();
    return 0;
  }

  const registry = createRegistry();
  await registerExternalAdapters(registry);

  if (!command) {
    return interactiveLauncher(registry);
  }

  try {
    switch (command) {
      case "detect":
        await runDetect(registry, { json, quick: bool(flags.quick) });
        return 0;

      case "doctor":
        await runDoctor(registry, { json, ...(str(flags.workspace) ? { workspace: str(flags.workspace) } : {}) });
        return 0;

      case "adapters":
        await runAdapters(registry, { json, quick: bool(flags.quick) });
        return 0;

      case "brains":
      case "harnesses": {
        const role = command === "brains" ? "brain" : "harness";
        const results = await registry.detectAll(bool(flags.quick));
        if (json) {
          ui.jsonOutput(results.filter((r) => r.role === role));
        } else {
          for (const result of results.filter((r) => r.role === role)) {
            const version = result.detection.version ? ui.dim(` ${result.detection.version}`) : "";
            ui.line(`  ${result.id.padEnd(18)} ${result.name.padEnd(20)} ${ui.dim(result.detection.status)}${version}`);
          }
        }
        return 0;
      }

      case "run": {
        const pairId = str(flags.pair);
        const brain = str(flags.brain);
        const harness = str(flags.harness);
        const positional = rest.join(" ").trim();
        // Which workflow this is decides everything below, so it is asked of the
        // one function that owns the rule — and is tested — rather than guessed
        // from the flags here.
        const decision = decideRunMode({
          ...(pairId ? { pairId } : {}),
          ...(bool(flags.relay) ? { forceRelay: true } : {}),
          ...(brain ? { brain } : {}),
          ...(harness ? { harness } : {}),
          ...(str(flags.workflow) ? { workflow: str(flags.workflow) } : {}),
          ...(str(flags.session) ? { session: str(flags.session) } : {}),
          ...(positional !== "" ? { positionalGoal: positional } : {}),
          ...(str(flags.goal) ? { goal: str(flags.goal) } : {}),
        });
        if (decision.mode === "rejected") {
          ui.fail(decision.error ?? "These flags contradict each other.");
          return 2;
        }
        if (decision.mode === "relay") {
          if (bool(flags["dry-run"])) {
            ui.fail("Relay Mode has no --dry-run: it executes real steps against the real harness, one at a time.");
            return 2;
          }
          return runRelay(registry, {
            ...(pairId ? { pair: pairId } : {}),
            ...(brain ? { brain } : {}),
            ...(harness ? { harness } : {}),
            ...(str(flags.workspace) ? { workspace: str(flags.workspace) } : {}),
            ...(str(flags.label) ? { label: str(flags.label) } : {}),
            ...(decision.goal !== undefined ? { goal: decision.goal } : {}),
            ...(str(flags["max-iterations"])
              ? { maxIterations: Number.parseInt(str(flags["max-iterations"])!, 10) }
              : {}),
            json,
            verbose,
            ignoreAuth: bool(flags["ignore-auth"]),
          });
        }
        return runRun(registry, {
          ...(brain ? { brain } : {}),
          ...(harness ? { harness } : {}),
          ...(str(flags.workflow) ? { workflow: str(flags.workflow) } : {}),
          ...(str(flags.workspace) ? { workspace: str(flags.workspace) } : {}),
          ...(decision.goal !== undefined ? { goal: decision.goal } : {}),
          ...(str(flags.session) ? { session: str(flags.session) } : {}),
          ...(str(flags["max-iterations"]) ? { maxIterations: Number.parseInt(str(flags["max-iterations"])!, 10) } : {}),
          ...(str(flags.endpoint) ? { endpoint: str(flags.endpoint) } : {}),
          json,
          verbose,
          dryRun: bool(flags["dry-run"]),
          ignoreAuth: bool(flags["ignore-auth"]),
        });
      }

      case "setup":
        await runSetup(registry, {
          ...(str(flags.brain) ? { brain: str(flags.brain) } : {}),
          ...(str(flags.harness) ? { harness: str(flags.harness) } : {}),
          ...(str(flags.workspace) ? { workspace: str(flags.workspace) } : {}),
          tunnel: bool(flags.tunnel),
        });
        return 0;

      case "pair": {
        const sub = rest[0];
        if (sub === "create") {
          return runPairCreate(registry, {
            ...(str(flags.brain) ? { brain: str(flags.brain) } : {}),
            ...(str(flags.harness) ? { harness: str(flags.harness) } : {}),
            ...(str(flags.workspace) ? { workspace: str(flags.workspace) } : {}),
            ...(str(flags.label) ? { label: str(flags.label) } : {}),
            ...(str(flags["context-mode"]) ? { contextMode: str(flags["context-mode"]) } : {}),
            json,
            verbose,
          });
        }
        if (sub === undefined || sub === "list") return runPairList({ json });
        if (sub === "show") return runPairShow(rest[1], { json });
        if (sub === "remove" || sub === "rm") return runPairRemove(rest[1], { json });
        // Anything else is a workspace path, which is what `a2l pair <path>`
        // has always taken: device pairing against the bridge. That command is
        // unchanged — it is a different "pair", and only shares the word.
        await runPair(sub);
        return 0;
      }

      case "unpair":
        await runUnpair(rest[0]);
        return 0;

      case "logs":
        await runLogs({ json, ...(str(flags.lines) ? { lines: Number.parseInt(str(flags.lines)!, 10) } : {}) });
        return 0;

      case "report":
        runReport({ json });
        return 0;

      case "version":
        runVersion();
        return 0;

      case "config": {
        if (rest[0] === "set" && rest[1] && rest[2]) {
          runConfigSet(rest[1], rest[2]);
        } else {
          await runConfigShow({ json });
        }
        return 0;
      }

      case "session": {
        const sub = rest[0];
        if (sub === "list" || !sub) return runSessionList({ json }).then(() => 0);
        if (sub === "show" && rest[1]) return runSessionShow(rest[1], { json }).then(() => 0);
        if (sub === "stop" && rest[1]) return runSessionStop(rest[1]).then(() => 0);
        if (sub === "resume" && rest[1]) {
          const id = rest[1];
          return runRun(registry, {
            session: id,
            ...(str(flags.brain) ? { brain: str(flags.brain) } : {}),
            ...(str(flags.harness) ? { harness: str(flags.harness) } : {}),
            json,
            verbose,
          });
        }
        usage();
        return 2;
      }

      case "workspace": {
        const sub = rest[0];
        if (sub === "add" && rest[1]) return runWorkspaceAdd(rest[1], rest[2]).then(() => 0);
        if (sub === "remove" && rest[1]) return runWorkspaceRemove(rest[1]).then(() => 0);
        return runWorkspaceList({ json }).then(() => 0);
      }

      default:
        ui.fail(`Unknown command '${command}'.`);
        usage();
        return 2;
    }
  } catch (error) {
    const normalized = isA2LError(error) ? error : new A2LError((error as Error).message, { cause: error });
    ui.errorOutput(normalized);
    if (verbose) ui.line(ui.dim(JSON.stringify(normalized.details, null, 2)));
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    ui.errorOutput(error);
    process.exit(1);
  });
