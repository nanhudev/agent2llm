/**
 * WorkBuddy harness adapter.
 *
 * WorkBuddy is a first-class Harness here, not a special case. Only real
 * entry points are used; nothing is invented.
 *
 * Verified on this machine (WorkBuddy 2.137.1, Windows):
 *   - CLI binary: `codebuddy` (alias `cbc`)
 *   - shipped inside the app bundle at
 *     <install>/resources/app.asar.unpacked/cli/bin/codebuddy
 *   - non-interactive mode: `-p` / `--print`
 *   - machine-readable output: `--output-format text|json|stream-json`
 *   - session resume: `-c` / `--continue`, `-r` / `--resume [sessionId]`
 *   - MCP injection: `--mcp-config <fileOrString>`
 *   - permission control: `--permission-mode acceptEdits|bypassPermissions|
 *     default|plan|dontAsk|auto`
 *   - `--model <id>`, `--tools`, `--allowedTools`, `--disallowedTools`
 *
 * The adapter probes all of that at runtime and downgrades capabilities
 * honestly when a flag is missing.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { withCapabilities, type CapabilityManifest } from "@agent2llm/protocol";
import {
  CliHarnessAdapter,
  parseJsonLine,
  stripAnsi,
  type CliHarnessProfile,
} from "@agent2llm/harness-cli-runtime";
import type {
  DetectionResult,
  DetectContext,
  ExecutionRequest,
  HarnessEvent,
  HarnessSession,
} from "@agent2llm/adapter-sdk";

const PROFILE: CliHarnessProfile = {
  id: "workbuddy",
  name: "WorkBuddy",
  bin: "codebuddy",
  altBins: ["cbc"],
  vendor: "Tencent",
  homepage: "https://www.workbuddy.cn",
  drives: "codebuddy",
  candidates: bundleCliCandidates(),
};

/**
 * WorkBuddy's CLI is not on PATH by default on Windows; it ships unpacked
 * next to the Electron app. These are bounded, well-known locations — never a
 * recursive disk scan.
 */
function bundleCliCandidates(): string[] {
  const out: string[] = [];
  const relative = path.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy");
  const roots = [
    process.env.WORKBUDDY_HOME,
    "D:/workbuddy",
    "C:/Program Files/WorkBuddy",
    path.join(os.homedir(), "AppData", "Local", "Programs", "WorkBuddy"),
    "/Applications/WorkBuddy.app/Contents/Resources",
  ].filter((value): value is string => typeof value === "string" && value !== "");
  for (const root of roots) {
    out.push(path.join(root, relative));
    out.push(path.join(root, "cli", "bin", "codebuddy"));
  }
  return out;
}

export class WorkBuddyHarnessAdapter extends CliHarnessAdapter {
  constructor() {
    super(PROFILE);
  }

  override async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    const result = await super.detect(ctx);
    if (this.location) {
      const notes = [...(result.notes ?? [])];
      if (this.hasFlag("--output-format")) notes.push("Structured output: --output-format is available.");
      if (this.hasFlag("--resume")) notes.push("Session resume: --resume is available.");
      if (this.hasFlag("--mcp-config")) notes.push("MCP injection: --mcp-config is available.");
      return { ...result, notes };
    }
    return result;
  }

  /**
   * WorkBuddy's open project is not readable, and this says so instead of
   * guessing.
   *
   * Measured on WorkBuddy 2.137.1: the only record of "which project" is
   * `~/.workbuddy/projects/<slug>/`, where `<slug>` is the absolute path with
   * every separator replaced by `-`. That is lossy in both directions —
   * `C:\a\my-project` and `C:\a\my\project` produce the same name — so the path
   * cannot be recovered without inventing one. The sibling `*.meta.json` files
   * sit behind the app's own file protection (reading one is denied on this
   * machine), so their shape could not be verified, and an unverified parser
   * that emits a *workspace root* is the most expensive kind of guess: a run
   * pointed at the wrong folder looks exactly like one that worked.
   *
   * Returning `null` is the documented way to say "this product does not
   * advertise a context". `agent2llm run` then asks for a folder, or takes
   * `--workspace`, which is a smaller cost than a confident wrong answer.
   */
  async getActiveContext(): Promise<null> {
    return null;
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const caps = withCapabilities(this.emptyManifestFor("subprocess"), [
      "session.create",
      "task.execute",
      "stream.events",
      "workspace.read",
      "workspace.write",
      "shell.execute",
      "git.inspect",
      "git.modify",
      "structuredOutput",
      "supportsHeadless",
      "interactiveApprovals",
      ...(this.hasFlag("--resume") ? (["session.attach", "session.resume"] as const) : []),
      ...(this.hasFlag("--mcp-config") ? (["mcp.remote"] as const) : []),
    ]);
    return {
      ...caps,
      ...(this.location?.version ? { version: this.location.version } : {}),
      limitations: [
        "Requires a WorkBuddy account/session on the machine; Agent2LLM does not manage WorkBuddy credentials.",
        ...(this.hasFlag("--resume") ? [] : ["This build did not advertise --resume; sessions will not continue across rounds."]),
        "Agent2LLM never bypasses permissions by default: --dangerously-skip-permissions is not used.",
        "Does not report an open project: Agent2LLM asks for the folder, or takes --workspace.",
      ],
      // Finding the binary is evidence the product is installed; it is not
      // evidence the user is signed in, and Agent2LLM deliberately does not
      // read another product's credential store to find out. Saying "unknown"
      // is the honest answer, and the first execution reports the truth.
      auth: { required: true, authenticated: false, checked: false, method: "WorkBuddy CLI login" },
      facts: {
        version: this.location?.version ?? "unknown",
        binary: this.location?.path ?? "not found",
        printFlag: this.hasFlag("--print") || this.hasFlag("-p"),
        outputFormatFlag: this.hasFlag("--output-format"),
        resumeFlag: this.hasFlag("--resume"),
        mcpConfigFlag: this.hasFlag("--mcp-config"),
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const args: string[] = ["--print"];
    if (this.hasFlag("--output-format")) args.push("--output-format", "stream-json");
    if (this.hasFlag("--permission-mode")) args.push("--permission-mode", "default");
    const resume = typeof session.ref.sessionRef === "string" ? session.ref.sessionRef : this.lastSessionRef();
    if (resume && this.hasFlag("--resume")) args.push("--resume", resume);
    if (typeof session.ref.mcpConfig === "string" && this.hasFlag("--mcp-config")) {
      args.push("--mcp-config", session.ref.mcpConfig);
    }
    if (typeof session.ref.model === "string" && this.hasFlag("--model")) {
      args.push("--model", session.ref.model);
    }
    args.push(this.renderTask(task));
    return args;
  }

  /**
   * WorkBuddy's house rule, layered on the shared brief.
   *
   * Skipped in execution-only mode: the relay policy is set by the Brain, and
   * "report what you changed at the end" is the opposite of not producing a
   * report. The evidence for a relay dispatch comes from Agent2LLM reading the
   * repository, not from the harness writing prose.
   */
  protected override extraBriefLines(task: ExecutionRequest): string {
    if (task.executionMode === "execution-only") return "";
    return "\n\nWork only inside the current workspace. Report what you changed and the test result at the end.";
  }

  protected extractSessionRef(line: string): string | null {
    const json = parseJsonLine(line);
    if (!json) return null;
    const direct = json.session_id ?? json.sessionId ?? json.session;
    if (typeof direct === "string") return direct;
    return null;
  }

  protected override extractChangedFiles(line: string): string[] {
    const json = parseJsonLine(line);
    if (!json) return [];
    const paths: string[] = [];
    const tool = json.tool ?? json.tool_name;
    if (typeof tool === "string" && /edit|write|notebook/i.test(tool)) {
      const file = json.file_path ?? json.path ?? json.filePath;
      if (typeof file === "string") paths.push(file);
    }
    return paths;
  }

  protected parseLine(line: string): HarnessEvent | null {
    const json = parseJsonLine(line);
    const at = new Date().toISOString();
    if (!json) {
      const clean = stripAnsi(line).trim();
      return clean === "" ? null : { type: "log", at, message: clean.slice(0, 500) };
    }
    const type = typeof json.type === "string" ? json.type : "";
    if (type.includes("error")) {
      return {
        type: "failed",
        at,
        error: { code: "ExecutionFailed", message: String(json.error ?? json.message ?? line).slice(0, 300) },
      };
    }
    if (type === "result" || type === "assistant") {
      const text = typeof json.result === "string" ? json.result : typeof json.text === "string" ? json.text : null;
      if (text) return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
    }
    if (type === "tool_use" || type === "tool_call") {
      const name = typeof json.name === "string" ? json.name : typeof json.tool === "string" ? json.tool : "tool";
      return { type: "log", at, message: `tool: ${name}` };
    }
    return null;
  }
}

/** Test/doc helper: is the WorkBuddy bundle present on this machine? */
export function workBuddyBundlePresent(): boolean {
  return fs.existsSync(path.join("D:/workbuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"));
}

export function createWorkBuddyHarness(): WorkBuddyHarnessAdapter {
  return new WorkBuddyHarnessAdapter();
}
