/**
 * Cursor harness adapter.
 *
 * "Cursor" here means the Cursor IDE **Agent**, not some generic CLI. The IDE
 * is the first-class concept: CursorIdeTransport is declared and modelled,
 * and CursorCliTransport is what actually runs headlessly today.
 *
 * Verified against the official Cursor CLI reference:
 *   agent -p [--output-format text|json|stream-json] [--force]
 *          [--workspace dir] [--trust] [--resume chatId] [--continue]
 *          [--model x] [--api-key k] "prompt"
 *   agent create-chat            -> prints a new chat id
 *   agent ls / agent resume      -> list / resume chats
 *   agent acp                    -> ACP server mode (advanced)
 *
 * This machine has no Cursor installed, so the adapter reports
 * `implemented / detected:false` honestly. Nothing is faked.
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
  id: "cursor",
  name: "Cursor",
  bin: "agent",
  altBins: ["cursor-agent"],
  vendor: "Cursor",
  homepage: "https://cursor.com",
  drives: "cursor-agent",
  candidates: [
    "~/.local/bin/agent",
    "~/.local/bin/cursor-agent",
    "C:/Program Files/Cursor/resources/app/bin/cursor-agent.cmd",
  ],
};

/**
 * The IDE surface. Declared as a real transport so the adapter does not
 * silently reduce "Cursor" to "a binary on PATH".
 */
export interface CursorIdeTransport {
  kind: "cursor-ide";
  /** Cursor exposes `agent acp` (Agent Client Protocol) for external clients. */
  acpAvailable: boolean;
  /** Resolved from the IDE installation when present. */
  idePath: string | null;
}

export class CursorHarnessAdapter extends CliHarnessAdapter {
  private ide: CursorIdeTransport = { kind: "cursor-ide", acpAvailable: false, idePath: null };

  constructor() {
    super(PROFILE);
  }

  /** Exposed for `agent2llm doctor`. */
  ideTransport(): CursorIdeTransport {
    return this.ide;
  }

  override async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    const result = await super.detect(ctx);
    this.ide = {
      kind: "cursor-ide",
      acpAvailable: this.hasFlag("acp"),
      idePath: this.location?.path ?? null,
    };
    if (this.location) {
      return {
        ...result,
        notes: [
          ...(result.notes ?? []),
          this.hasFlag("--output-format") ? "Structured output available." : "No --output-format in this build.",
          this.hasFlag("--resume") ? "Chat resume available." : "No --resume in this build.",
          this.hasFlag("acp") ? "ACP server mode available (agent acp)." : "ACP server mode not advertised.",
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
        "No Cursor installation was verified in this environment; contract-validated only.",
        "Headless runs need a CURSOR_API_KEY or an existing `agent login` session.",
        "The Cursor IDE Agent itself is modelled by CursorIdeTransport; Agent2LLM drives the CLI transport for automation.",
      ],
      auth: { required: true, authenticated: false, checked: false, method: "CURSOR_API_KEY or `agent login`" },
      facts: {
        version: this.location?.version ?? "unknown",
        printFlag: this.hasFlag("--print"),
        outputFormatFlag: this.hasFlag("--output-format"),
        resumeFlag: this.hasFlag("--resume"),
        acpFlag: this.hasFlag("acp"),
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const args: string[] = ["--print"];
    if (this.hasFlag("--output-format")) args.push("--output-format", "stream-json");
    if (this.hasFlag("--workspace")) args.push("--workspace", task.workspaceRoot);
    if (this.hasFlag("--trust")) args.push("--trust");
    if (this.hasFlag("--force")) args.push("--force");
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
    const id = json.session_id ?? json.sessionId ?? json.chatId ?? json.chat_id;
    return typeof id === "string" ? id : null;
  }

  protected override extractChangedFiles(line: string): string[] {
    const json = parseJsonLine(line);
    if (!json) return [];
    const toolCall = json.tool_call;
    if (typeof toolCall !== "object" || toolCall === null) return [];
    const write = (toolCall as Record<string, unknown>).writeToolCall;
    if (typeof write !== "object" || write === null) return [];
    const path = (write as Record<string, unknown>).path;
    return typeof path === "string" ? [path] : [];
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
        error: { code: "ExecutionFailed", message: String(json.message ?? json.error ?? line).slice(0, 300) },
      };
    }
    if (type === "result" && typeof json.result === "string") {
      return { type: "log", at, message: stripAnsi(json.result).slice(0, 500) };
    }
    if (type === "assistant") {
      const content = (json.message as Record<string, unknown> | undefined)?.content;
      const text = Array.isArray(content)
        ? content.map((c) => String((c as Record<string, unknown>).text ?? "")).join("")
        : null;
      if (text) return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
    }
    return null;
  }
}

export function createCursorHarness(): CursorHarnessAdapter {
  return new CursorHarnessAdapter();
}
