/**
 * Codex harness adapter.
 *
 * ChatGPT x Codex is already solved by C2C, so this adapter targets
 * compatibility and migration rather than a re-proving of the combination.
 * It maps C2C semantics onto A2L and drives only documented Codex flags.
 *
 * Verified against the official Codex CLI reference:
 *   codex exec [--cd path] [--json] [--sandbox workspace-write]
 *              [--skip-git-repo-check] [--color never]
 *              [--output-last-message file] [PROMPT | -]
 *   codex exec resume [SESSION_ID] [--cd path] ...
 * JSONL events include thread.started (thread_id), item.completed,
 * turn.completed and error.
 */
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
  id: "codex",
  name: "Codex",
  bin: "codex",
  vendor: "OpenAI",
  homepage: "https://developers.openai.com/codex",
  drives: "codex",
};

export class CodexHarnessAdapter extends CliHarnessAdapter {
  constructor() {
    super(PROFILE);
  }

  override async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    const result = await super.detect(ctx);
    if (this.location) {
      return {
        ...result,
        notes: [
          ...(result.notes ?? []),
          this.hasFlag("exec") ? "`codex exec` is available for non-interactive runs." : "`codex exec` was not advertised by this build.",
        ],
      };
    }
    return result;
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const detected = this.isDetected();
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
      ...(detected && this.hasFlag("resume") ? (["session.attach", "session.resume"] as const) : []),
    ]);
    return {
      ...caps,
      ...(this.location?.version ? { version: this.location.version } : {}),
      limitations: [
        "Runs with --sandbox workspace-write: the workspace is writable, nothing outside it is.",
        ...(this.hasFlag("resume") ? [] : ["Session resume was not advertised by this build."]),
        "Authentication is owned by Codex (CODEX_HOME); Agent2LLM never reads or stores it.",
      ],
      auth: { required: true, authenticated: false, method: "Codex CLI sign-in (CODEX_HOME)" },
      facts: {
        version: this.location?.version ?? "unknown",
        execSubcommand: this.hasFlag("exec"),
        resumeSubcommand: this.hasFlag("resume"),
        jsonFlag: this.hasFlag("--json"),
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const resume = typeof session.ref.sessionRef === "string" ? session.ref.sessionRef : this.lastSessionRef();
    const args: string[] = ["exec"];
    if (resume && this.hasFlag("resume")) {
      args.push("resume", resume);
    }
    if (this.hasFlag("--cd")) args.push("--cd", task.workspaceRoot);
    if (this.hasFlag("--sandbox")) args.push("--sandbox", "workspace-write");
    if (this.hasFlag("--json")) args.push("--json");
    if (this.hasFlag("--color")) args.push("--color", "never");
    if (this.hasFlag("--skip-git-repo-check")) args.push("--skip-git-repo-check");
    args.push(this.renderTask(task));
    return args;
  }

  private renderTask(task: ExecutionRequest): string {
    return [
      `Goal: ${task.goal}`,
      "",
      "Steps:",
      ...task.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
      ...(task.successCriteria ? ["", `Success criteria: ${task.successCriteria}`] : []),
    ].join("\n");
  }

  protected extractSessionRef(line: string): string | null {
    const json = parseJsonLine(line);
    if (!json) return null;
    if (json.type === "thread.started" && typeof json.thread_id === "string") return json.thread_id;
    const thread = json.thread_id ?? json.threadId;
    return typeof thread === "string" ? thread : null;
  }

  protected override extractChangedFiles(line: string): string[] {
    const json = parseJsonLine(line);
    if (!json || json.type !== "item.completed") return [];
    const item = json.item;
    if (typeof item !== "object" || item === null) return [];
    const type = (item as Record<string, unknown>).type;
    if (typeof type !== "string" || !/file_change|file/i.test(type)) return [];
    const file = (item as Record<string, unknown>).path ?? (item as Record<string, unknown>).file;
    return typeof file === "string" ? [file] : [];
  }

  protected parseLine(line: string): HarnessEvent | null {
    const json = parseJsonLine(line);
    const at = new Date().toISOString();
    if (!json) {
      const clean = stripAnsi(line).trim();
      return clean === "" ? null : { type: "log", at, message: clean.slice(0, 500) };
    }
    const type = typeof json.type === "string" ? json.type : "";
    if (type === "error" || type === "turn.failed") {
      return {
        type: "failed",
        at,
        error: { code: "ExecutionFailed", message: String(json.message ?? json.error ?? line).slice(0, 300) },
      };
    }
    if (type === "item.completed") {
      const item = json.item as Record<string, unknown> | undefined;
      const text = item && typeof item.text === "string" ? item.text : null;
      if (text) return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
      const command = item && typeof item.command === "string" ? item.command : null;
      if (command) return { type: "log", at, message: `$ ${command.slice(0, 300)}` };
    }
    return null;
  }
}

export function createCodexHarness(): CodexHarnessAdapter {
  return new CodexHarnessAdapter();
}
