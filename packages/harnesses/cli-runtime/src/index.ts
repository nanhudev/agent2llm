/**
 * Shared runtime for CLI-driven Harness adapters.
 *
 * Every real coding agent we support ships (or can be driven by) a command
 * line entry point. This base class owns everything that is genuinely common
 * — binary discovery, `--help` capability probing, subprocess execution,
 * event normalisation, cancellation — and leaves only product knowledge
 * (argv shape, output parsing) to the concrete adapter.
 */
import { emptyManifest, type CapabilityManifest } from "@agent2llm/protocol";
import { harnessUnavailable } from "@agent2llm/core";
import { locateBinary, readVersion, type BinaryLocation } from "@agent2llm/detect";
import { helpMentions, readHelp, runProcess, type RunningProcess, type RunOutcome } from "@agent2llm/transports";
import { meaningfulLine, type ExecutionAccumulator } from "./helpers.js";
import {
  BaseHarnessAdapter,
  type AdapterMetadata,
  type DetectionResult,
  type DetectContext,
  type ExecutionHandle,
  type ExecutionRequest,
  type HarnessEvent,
  type HarnessSession,
} from "@agent2llm/adapter-sdk";

export interface CliHarnessProfile {
  id: string;
  name: string;
  bin: string;
  /** Alternate binary names (e.g. `agent` for `cursor-agent`). */
  altBins?: readonly string[];
  vendor?: string;
  homepage?: string;
  /** Extra installation locations probed beyond PATH. */
  candidates?: readonly string[];
  /**
   * Product-owned directories holding versioned binaries; the newest match for
   * `versionedPattern` wins. Codex Desktop stages its CLI this way.
   */
  versionedDirs?: readonly string[];
  versionedPattern?: RegExp;
  /**
   * Subcommand whose `--help` advertises the real flag surface, when the
   * top-level help only points at subcommands (e.g. `codex exec --help`).
   */
  helpSubcommand?: string;
  experimental?: boolean;
  /** Product this adapter drives, shown by `agent2llm adapters`. */
  drives?: string;
}

export abstract class CliHarnessAdapter extends BaseHarnessAdapter {
  protected location: BinaryLocation | null = null;
  protected help: string | null = null;
  private detectAttempted = false;
  /** Did the last detect actually read `--help`, or skip it as too expensive? */
  private helpProbed = false;
  private readonly runs = new Map<string, RunningProcess>();
  private readonly sessionRefs = new Map<string, string>();

  constructor(protected readonly profile: CliHarnessProfile) {
    super();
  }

  metadata(): AdapterMetadata {
    return {
      id: this.profile.id,
      name: this.profile.name,
      version: "0.1.0",
      role: "harness",
      ...(this.profile.vendor ? { vendor: this.profile.vendor } : {}),
      ...(this.profile.homepage ? { homepage: this.profile.homepage } : {}),
      experimental: this.profile.experimental ?? false,
      ...(this.profile.drives ? { drives: this.profile.drives } : { drives: this.profile.bin }),
    };
  }

  /**
   * Capability manifests for a CLI harness depend on what is actually
   * installed, so discovery runs once on demand.
   *
   * Without this, a consumer that asks for capabilities before calling
   * `detect()` would see an empty manifest and conclude — wrongly — that the
   * harness lacks `shell.execute` and friends.
   */
  override async capabilities(): Promise<CapabilityManifest> {
    if (!this.location && !this.detectAttempted) await this.detect();
    return super.capabilities();
  }

  /**
   * Probe the flag surface when the report is about to be read by a human.
   *
   * `hasFlag` cannot answer before `--help` is read, and a capability report
   * full of `false` is worse than a slow one: it is indistinguishable from a
   * build that genuinely lacks the flags. Commands that display capabilities
   * call this first; `run` does it implicitly through `execute()`.
   */
  async capabilitiesResolved(): Promise<CapabilityManifest> {
    await this.resolveFlags();
    return this.capabilities();
  }

  // ---- discovery -----------------------------------------------------------

  async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    this.detectAttempted = true;
    const names = [this.profile.bin, ...(this.profile.altBins ?? [])];
    const locateOptions = {
      ...(this.profile.candidates ? { candidates: this.profile.candidates } : {}),
      ...(this.profile.versionedDirs ? { versionedDirs: this.profile.versionedDirs } : {}),
      ...(this.profile.versionedPattern ? { versionedPattern: this.profile.versionedPattern } : {}),
      probeVersion: !ctx.quick,
    };
    for (const name of names) {
      const found = await locateBinary(name, locateOptions);
      if (found) {
        this.location = found;
        if (!ctx.quick) {
          this.help = await this.readHelpFor(found.path);
          this.helpProbed = true;
        }
        return {
          status: "detected",
          binaryPath: found.path,
          ...(found.version ? { version: found.version } : {}),
          reason: `Found ${name} at ${found.path} (${found.source}).`,
        };
      }
    }
    return {
      status: "implemented",
      reason: `${names.join(" / ")} was not found on PATH or in the probed install locations.`,
      notes: ["Install the product and re-run `agent2llm detect` to enable this harness."],
    };
  }

  /**
   * Some products hide the flag surface one level down: `codex --help` lists
   * subcommands, while `codex exec --help` is what advertises `--json`,
   * `--sandbox` and friends. Probe the subcommand first when one is declared.
   */
  private async readHelpFor(binPath: string): Promise<string | null> {
    if (this.profile.helpSubcommand) {
      const sub = await readHelp(binPath, [this.profile.helpSubcommand]).catch(() => null);
      if (sub) return sub;
    }
    return readHelp(binPath).catch(() => null);
  }

  protected isDetected(): boolean {
    return this.location !== null;
  }

  protected requireBinary(): BinaryLocation {
    if (!this.location) {
      throw harnessUnavailable(
        `${this.profile.name} is not installed or not on PATH. Install it, then run 'agent2llm detect'.`
      );
    }
    return this.location;
  }

  /**
   * True when the probed `--help` output mentions the flag.
   *
   * A quick detect skips the help probe, and answering `false` for a question
   * nobody asked is how a fully working Codex came to be reported with
   * `version: unknown` and every capability switched off: the CLI always
   * detects quickly, so the flag surface was never read, and the manifest
   * stated the absence of flags as fact. An unprobed harness therefore reports
   * *no* claim rather than a negative one, and `resolveFlags()` fetches the
   * real answer before a run depends on it.
   */
  protected hasFlag(flag: string): boolean {
    return helpMentions(this.help, flag);
  }

  /** True once `--help` has actually been read, so `hasFlag` means something. */
  protected get flagsProbed(): boolean {
    return this.helpProbed;
  }

  /**
   * Complete the report before a human reads it.
   *
   * A quick detect skips two things, and both look like facts when they are
   * gaps: the flag surface was never read, and the version was never probed.
   * Filling in only the flags still leaves `agent2llm adapters` printing
   * `unknown` for a harness it just found, which reads as a broken install.
   * `run` also needs this: `buildArgs` gates `--json` on `hasFlag`, so an
   * unprobed harness would silently drop the flag its own parser needs.
   */
  protected async resolveFlags(): Promise<void> {
    if (!this.location && !this.detectAttempted) await this.detect();
    if (!this.location) return;
    if (!this.helpProbed) {
      this.help = await this.readHelpFor(this.location.path);
      this.helpProbed = true;
    }
    if (this.location.version === null) {
      this.location = { ...this.location, version: await readVersion(this.location.path) };
    }
  }

  protected emptyManifestFor(transport: CapabilityManifest["transport"]): CapabilityManifest {
    return emptyManifest(transport);
  }

  // ---- product-specific hooks ---------------------------------------------

  /** argv for one execution round. Must not invent flags: check `hasFlag`. */
  protected abstract buildArgs(task: ExecutionRequest, session: HarnessSession): string[];

  /** Map one output line to a normalized event, or null to ignore it. */
  protected abstract parseLine(line: string): HarnessEvent | null;

  /** Pull a resumable session/thread id out of the output stream. */
  protected abstract extractSessionRef(line: string): string | null;

  /** Optional: derive changed files from a product-specific event payload. */
  protected extractChangedFiles(_line: string): string[] {
    return [];
  }

  // ---- lifecycle -----------------------------------------------------------

  async createSession(): Promise<HarnessSession> {
    return { id: `${this.profile.id}-${Date.now()}`, adapterId: this.profile.id, ref: {} };
  }

  async attachSession(checkpoint: { adapterId: string; ref: Record<string, unknown> }): Promise<HarnessSession> {
    const ref = checkpoint.ref.sessionRef;
    if (typeof ref === "string") this.sessionRefs.set("last", ref);
    return { id: `${this.profile.id}-${Date.now()}`, adapterId: this.profile.id, ref: checkpoint.ref };
  }

  async execute(session: HarnessSession, task: ExecutionRequest): Promise<ExecutionHandle> {
    const bin = this.requireBinary();
    // The argv is built from probed flags, so make sure they were probed. A
    // run that skipped this dropped `--json` and then could not parse its own
    // output, which reads as "the harness produced nothing" rather than as the
    // missing probe it actually was.
    await this.resolveFlags();
    const handleId = `${this.profile.id}-${task.taskId}-${task.iteration}-${Date.now()}`;
    const args = this.buildArgs(task, session);
    const proc = runProcess({
      bin: bin.path,
      args,
      cwd: task.workspaceRoot,
      timeoutMs: 45 * 60 * 1000,
    });
    this.runs.set(handleId, proc);
    return { id: handleId, adapterId: this.profile.id, ref: { args, pid: proc.child.pid ?? 0 } };
  }

  async *events(handle: ExecutionHandle): AsyncIterable<HarnessEvent> {
    const proc = this.runs.get(handle.id);
    if (!proc) {
      yield {
        type: "failed",
        at: new Date().toISOString(),
        error: { code: "ExecutionFailed", message: `Unknown execution handle ${handle.id}.` },
      };
      return;
    }
    yield { type: "started", at: new Date().toISOString(), handleId: handle.id };

    const acc: ExecutionAccumulator = {
      ok: false,
      exitStatus: "running",
      changedFiles: [],
      tests: null,
      summary: "",
      commands: [],
      sessionRef: null,
    };
    let lastText = "";
    /**
     * The harness's own failure sentence, when it produced one.
     *
     * A failing CLI often emits a structured error event and *then* keeps
     * talking — retries, transport fallbacks, a wall of prose about what it
     * tried. Taking the last line would hand the Brain a truncated fragment of
     * a stack message instead of the reason. The first structured failure is
     * the reason, so it is kept separately from `lastText`.
     */
    let firstFailure: string | null = null;

    for await (const event of proc.events()) {
      if (event.stream === "stderr") {
        yield { type: "log", at: new Date().toISOString(), message: event.line.slice(0, 500) };
        continue;
      }
      const ref = this.extractSessionRef(event.line);
      if (ref) {
        acc.sessionRef = ref;
        this.sessionRefs.set("last", ref);
      }
      for (const file of this.extractChangedFiles(event.line)) {
        if (!acc.changedFiles.includes(file)) acc.changedFiles.push(file);
      }
      const parsed = this.parseLine(event.line);
      if (parsed) {
        if (parsed.type === "log") lastText = parsed.message;
        if (parsed.type === "failed" && !firstFailure) firstFailure = parsed.error.message;
        yield parsed;
      } else {
        lastText = event.line;
        yield { type: "log", at: new Date().toISOString(), message: event.line.slice(0, 500) };
      }
    }

    const outcome = await proc.outcome();
    acc.ok = !outcome.timedOut && outcome.exitCode === 0;
    acc.exitStatus = outcome.timedOut ? "timeout" : String(outcome.exitCode ?? "unknown");
    acc.summary = this.summarize(outcome, acc, firstFailure, lastText);

    this.runs.delete(handle.id);

    yield {
      type: acc.ok ? "completed" : "failed",
      at: new Date().toISOString(),
      ...(acc.ok
        ? {
            result: {
              ok: true,
              exitStatus: acc.exitStatus,
              changedFiles: acc.changedFiles,
              tests: acc.tests,
              summary: acc.summary,
              commands: acc.commands,
              durationMs: outcome.durationMs,
            },
          }
        : {
            error: {
              code: outcome.timedOut ? "Timeout" : "ExecutionFailed",
              message: acc.summary,
            },
          }),
    } as HarnessEvent;
  }

  async cancel(handle: ExecutionHandle): Promise<void> {
    this.runs.get(handle.id)?.cancel();
  }

  async close(): Promise<void> {
    for (const proc of this.runs.values()) proc.cancel();
    this.runs.clear();
  }

  protected lastSessionRef(): string | null {
    return this.sessionRefs.get("last") ?? null;
  }

  /**
   * One sentence the Brain can act on.
   *
   * Order matters. A structured failure beats everything: it is the harness
   * saying what went wrong, in its own vocabulary. A timeout is next. Only
   * then does the last line of output get a turn, and even then it is worth
   * checking that it is prose rather than the middle of a JSON blob — a
   * truncated serialisation reads as noise to a reviewer.
   *
   * On success the last line is usually the agent's own final message, which
   * is exactly what we want to hand over.
   */
  protected summarize(
    outcome: RunOutcome,
    acc: ExecutionAccumulator,
    firstFailure: string | null,
    lastText: string
  ): string {
    if (outcome.timedOut) {
      return `${this.profile.name} timed out after ${Math.round(outcome.durationMs / 1000)}s.`;
    }
    if (firstFailure) return firstFailure.slice(0, 500);
    if (outcome.exitCode === 0) {
      return (lastText || `${this.profile.name} finished successfully.`).slice(0, 500);
    }
    const readable = meaningfulLine(lastText);
    if (readable) return readable.slice(0, 500);
    return `${this.profile.name} failed with exit code ${acc.exitStatus} and produced no readable message.`;
  }
}

// Line-level helpers live in their own module to keep this file inside the
// project's line budget. Re-exported because every harness adapter imports them
// from this package's entry point.
export { meaningfulLine, parseJsonLine, stripAnsi, type ExecutionAccumulator } from "./helpers.js";