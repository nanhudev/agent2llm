/**
 * Claude Code harness adapter.
 *
 * Verified against the official Claude Code CLI reference:
 *   claude -p "prompt" [--output-format text|json|stream-json]
 *          [--resume id] [--continue] [--permission-mode plan|default|...]
 *          [--json-schema {...}] [--bare] [--verbose] [--include-partial-messages]
 * JSON output carries `session_id`, `result`, `usage`.
 *
 * Not installed on this machine: reported as implemented/unverified, never
 * as working.
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
  id: "claude-code",
  name: "Claude Code",
  bin: "claude",
  vendor: "Anthropic",
  homepage: "https://docs.claude.com/docs/claude-code",
  drives: "claude",
};

export class ClaudeCodeHarnessAdapter extends CliHarnessAdapter {
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
          this.hasFlag("-p") ? "Headless mode (-p) available." : "Headless flag -p not advertised.",
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
      "workspace.read",
      "workspace.write",
      "shell.execute",
      "git.inspect",
      "git.modify",
      ...(detected && this.hasFlag("--output-format") ? (["stream.events", "structuredOutput"] as const) : []),
      ...(detected && this.hasFlag("--resume") ? (["session.attach", "session.resume"] as const) : []),
      ...(detected ? (["supportsHeadless"] as const) : []),
    ]);
    return {
      ...caps,
      ...(this.location?.version ? { version: this.location.version } : {}),
      limitations: [
        "Not installed in this environment: contract-validated, real execution unverified.",
        "Interactive terminal scraping is deliberately not used; only -p/--print mode.",
      ],
      auth: { required: true, authenticated: false, method: "Claude Code login / ANTHROPIC_API_KEY" },
      facts: {
        version: this.location?.version ?? "unknown",
        printFlag: this.hasFlag("-p"),
        outputFormatFlag: this.hasFlag("--output-format"),
        resumeFlag: this.hasFlag("--resume"),
        permissionModeFlag: this.hasFlag("--permission-mode"),
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const args: string[] = ["-p"];
    if (this.hasFlag("--output-format")) args.push("--output-format", "stream-json");
    if (this.hasFlag("--verbose")) args.push("--verbose");
    const resume = typeof session.ref.sessionRef === "string" ? session.ref.sessionRef : this.lastSessionRef();
    if (resume && this.hasFlag("--resume")) args.push("--resume", resume);
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
    const id = json.session_id ?? json.sessionId;
    return typeof id === "string" ? id : null;
  }

  protected parseLine(line: string): HarnessEvent | null {
    const json = parseJsonLine(line);
    const at = new Date().toISOString();
    if (!json) {
      const clean = stripAnsi(line).trim();
      return clean === "" ? null : { type: "log", at, message: clean.slice(0, 500) };
    }
    const type = typeof json.type === "string" ? json.type : "";
    if (type === "error" || type === "result" && json.is_error === true) {
      return {
        type: "failed",
        at,
        error: { code: "ExecutionFailed", message: String(json.error ?? json.message ?? line).slice(0, 300) },
      };
    }
    if (type === "result" && typeof json.result === "string") {
      return { type: "log", at, message: stripAnsi(json.result).slice(0, 500) };
    }
    if (type === "assistant") {
      const text = json.text ?? (json.message as Record<string, unknown> | undefined)?.content;
      if (typeof text === "string") return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
    }
    return null;
  }
}

export function createClaudeCodeHarness(): ClaudeCodeHarnessAdapter {
  return new ClaudeCodeHarnessAdapter();
}
