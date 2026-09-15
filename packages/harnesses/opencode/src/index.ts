/**
 * OpenCode harness adapter.
 *
 * Verified against the official OpenCode CLI reference:
 *   opencode run [message..] [--format default|json] [--continue|-c]
 *                [--session id] [--dir path] [--model provider/model]
 *                [--agent name] [--attach url] [--standalone]
 *   opencode session list --format json
 * Session ids look like `ses_...`.
 *
 * Not installed here: implemented, contract-validated, execution unverified.
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
  id: "opencode",
  name: "OpenCode",
  bin: "opencode",
  homepage: "https://opencode.ai",
  drives: "opencode",
};

export class OpenCodeHarnessAdapter extends CliHarnessAdapter {
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
          this.hasFlag("run") ? "`opencode run` available." : "`opencode run` not advertised.",
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
      ...(detected && this.hasFlag("--format") ? (["stream.events", "structuredOutput"] as const) : []),
      ...(detected && this.hasFlag("--session") ? (["session.attach", "session.resume"] as const) : []),
      ...(detected ? (["supportsHeadless"] as const) : []),
    ]);
    return {
      ...caps,
      ...(this.location?.version ? { version: this.location.version } : {}),
      limitations: [
        "Not installed in this environment: contract-validated, real execution unverified.",
        "`--format json` emits raw JSON events; plain-text runs are logged line by line.",
      ],
      auth: { required: true, authenticated: false, method: "provider API key via `opencode auth login`" },
      facts: {
        version: this.location?.version ?? "unknown",
        runSubcommand: this.hasFlag("run"),
        formatFlag: this.hasFlag("--format"),
        sessionFlag: this.hasFlag("--session"),
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const args: string[] = ["run"];
    if (this.hasFlag("--format")) args.push("--format", "json");
    if (this.hasFlag("--dir")) args.push("--dir", task.workspaceRoot);
    const resume = typeof session.ref.sessionRef === "string" ? session.ref.sessionRef : this.lastSessionRef();
    if (resume && this.hasFlag("--session")) args.push("--session", resume);
    if (typeof session.ref.agent === "string" && this.hasFlag("--agent")) {
      args.push("--agent", session.ref.agent);
    }
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
    if (json) {
      const id = json.sessionID ?? json.sessionId ?? json.session_id;
      if (typeof id === "string") return id;
    }
    const match = /ses_[A-Za-z0-9]+/.exec(line);
    return match ? match[0] : null;
  }

  protected parseLine(line: string): HarnessEvent | null {
    const json = parseJsonLine(line);
    const at = new Date().toISOString();
    if (!json) {
      const clean = stripAnsi(line).trim();
      return clean === "" ? null : { type: "log", at, message: clean.slice(0, 500) };
    }
    const type = typeof json.type === "string" ? json.type : "";
    if (type === "error") {
      return {
        type: "failed",
        at,
        error: { code: "ExecutionFailed", message: String(json.error ?? json.message ?? line).slice(0, 300) },
      };
    }
    const text = typeof json.text === "string" ? json.text : typeof json.content === "string" ? json.content : null;
    if (text) return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
    return null;
  }
}

export function createOpenCodeHarness(): OpenCodeHarnessAdapter {
  return new OpenCodeHarnessAdapter();
}
