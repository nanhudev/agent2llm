/**
 * DeepSeek Harness adapter.
 *
 * DSH is plugin-oriented ("everything is a plugin") and still in developer
 * preview, so this adapter never hard-codes internal APIs. It prefers, in
 * order:
 *   1. non-interactive headless profile  (`dsh --profile headless "<task>"`)
 *   2. an explicit profile with --resume for session continuity
 *   3. config introspection (`--dump-config`) for capability probing
 *
 * Facts verified against the locally installed build (dsh 0.1.2-rc.1):
 *   - `dsh --version`
 *   - `dsh --profile <name>` boots a profile from $DSH_HOME/profiles
 *   - example from the tool's own help: `dsh --profile headless "run the tests"`
 *   - example from the tool's own help: `dsh --profile tui --resume <session>`
 *   - `dsh --dump-config` / `--dump-default-config` print the composed profile
 *   - profiles live under $DSH_HOME/profiles (desktop, headless, web, ...)
 *
 * All of that is probed at runtime by DshCompatibilityLayer, never assumed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  id: "dsh",
  name: "DeepSeek Harness",
  bin: "dsh",
  vendor: "DeepSeek",
  homepage: "https://github.com/deepseek-ai",
  drives: "dsh",
  experimental: true,
};

export interface DshFacts {
  version: string | null;
  dshHome: string | null;
  profiles: string[];
  headlessAvailable: boolean;
  resumeAvailable: boolean;
  dumpConfigAvailable: boolean;
}

export function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}

/**
 * Feature detection instead of version pinning: DSH changes fast, so every
 * capability is derived from what the installed build actually advertises.
 */
export class DshCompatibilityLayer {
  private facts: DshFacts = {
    version: null,
    dshHome: null,
    profiles: [],
    headlessAvailable: false,
    resumeAvailable: false,
    dumpConfigAvailable: false,
  };

  update(next: Partial<DshFacts>): DshFacts {
    this.facts = { ...this.facts, ...next };
    return this.facts;
  }

  get current(): DshFacts {
    return this.facts;
  }

  /** Read-only inspection of $DSH_HOME. Never mutates the user's DSH state. */
  probeFilesystem(): Partial<DshFacts> {
    const home = dshHome();
    if (!fs.existsSync(home)) return { dshHome: null, profiles: [] };
    const profilesDir = path.join(home, "profiles");
    let profiles: string[] = [];
    try {
      profiles = fs
        .readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
        .map((entry) => entry.name);
    } catch {
      profiles = [];
    }
    return {
      dshHome: home,
      profiles,
      headlessAvailable: profiles.includes("headless"),
    };
  }
}

export class DeepSeekHarnessAdapter extends CliHarnessAdapter {
  private readonly compat = new DshCompatibilityLayer();
  private preferredProfile: string | null = null;

  constructor() {
    super(PROFILE);
  }

  /** Exposed for `agent2llm doctor` and the compatibility probes. */
  compatibility(): DshFacts {
    return this.compat.current;
  }

  override async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    const result = await super.detect(ctx);
    this.compat.update(this.compat.probeFilesystem());
    if (this.location) {
      this.compat.update({
        version: this.location.version,
        resumeAvailable: this.help ? /--resume/.test(this.help) : false,
        dumpConfigAvailable: this.help ? /--dump-config/.test(this.help) : false,
      });
      const profiles = this.compat.current.profiles;
      this.preferredProfile = profiles.includes("headless") ? "headless" : profiles[0] ?? null;
    }
    const facts = this.compat.current;
    if (this.location) {
      const notes = [
        `DSH home: ${facts.dshHome ?? "not found"}`,
        `Profiles: ${facts.profiles.join(", ") || "none"}`,
      ];
      if (!facts.headlessAvailable) {
        notes.push("No 'headless' profile found; non-interactive execution may not be available.");
      }
      return { ...result, notes: [...(result.notes ?? []), ...notes] };
    }
    return result;
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const facts = this.compat.current;
    const detected = this.isDetected();
    const caps = withCapabilities(this.emptyManifestFor("subprocess"), [
      "session.create",
      "task.execute",
      "stream.events",
      "workspace.read",
      "workspace.write",
      "git.inspect",
      ...(detected && facts.resumeAvailable ? (["session.attach", "session.resume"] as const) : []),
      ...(detected ? (["shell.execute", "git.modify", "structuredOutput"] as const) : []),
      ...(detected && facts.headlessAvailable ? (["supportsHeadless"] as const) : []),
    ]);
    return {
      ...caps,
      ...(this.location?.version ? { version: this.location.version } : {}),
      experimental: true,
      limitations: [
        "DeepSeek Harness is a developer preview; plugin and profile internals may change without notice.",
        ...(facts.headlessAvailable
          ? []
          : ["No 'headless' profile detected: non-interactive one-shot execution is unavailable."]),
        ...(facts.resumeAvailable ? [] : ["Session resume was not advertised by this build."]),
        "Terminal UI scraping is deliberately not used; only documented flags are invoked.",
      ],
      auth: { required: false, authenticated: false },
      facts: {
        version: facts.version ?? "unknown",
        dshHome: facts.dshHome ?? "unknown",
        profiles: facts.profiles.join(","),
        headlessProfile: facts.headlessAvailable,
        resumeSupported: facts.resumeAvailable,
      },
    };
  }

  protected buildArgs(task: ExecutionRequest, session: HarnessSession): string[] {
    this.requireBinary();
    const profile =
      this.preferredProfile ?? (this.compat.current.headlessAvailable ? "headless" : "tui");
    const resume = typeof session.ref.sessionRef === "string" ? session.ref.sessionRef : this.lastSessionRef();
    const args: string[] = ["--profile", profile];
    if (resume && this.compat.current.resumeAvailable) args.push("--resume", resume);
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
    if (json && typeof json.session === "string") return json.session;
    const match = /session[=_:-]\s*([A-Za-z0-9_-]{6,})/i.exec(stripAnsi(line));
    return match ? match[1]! : null;
  }

  protected parseLine(line: string): HarnessEvent | null {
    const json = parseJsonLine(line);
    if (json) {
      const type = typeof json.type === "string" ? json.type : "";
      const at = new Date().toISOString();
      if (type.includes("error") || type.includes("failed")) {
        return {
          type: "failed",
          at,
          error: { code: "ExecutionFailed", message: String(json.message ?? json.error ?? line).slice(0, 300) },
        };
      }
      const text = typeof json.text === "string" ? json.text : typeof json.message === "string" ? json.message : null;
      if (text) return { type: "log", at, message: stripAnsi(text).slice(0, 500) };
      return null;
    }
    const clean = stripAnsi(line).trim();
    if (clean === "") return null;
    return { type: "log", at: new Date().toISOString(), message: clean.slice(0, 500) };
  }
}

export function createDeepSeekHarness(): DeepSeekHarnessAdapter {
  return new DeepSeekHarnessAdapter();
}
