import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BaseHarnessAdapter, type DetectionResult, type HarnessEvent } from "@agent2llm/adapter-sdk";
import { emptyManifest } from "@agent2llm/protocol";

export const ZCODE_LIMITATION = "ZCode execution is unavailable: no supported external execution contract has been verified. Desktop installation alone does not enable this adapter.";

/** Presence is separate from execution support. Never extract or launch private runtime files. */
export class ZCodeHarnessAdapter extends BaseHarnessAdapter {
  constructor(private readonly candidates: readonly string[] = [
    ...(process.env.ZCODE_HOME ? [path.join(process.env.ZCODE_HOME, "ZCode.exe")] : []),
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Programs", "ZCode", "ZCode.exe"),
    path.join(process.env.PROGRAMFILES ?? "C:/Program Files", "ZCode", "ZCode.exe"),
    "/Applications/ZCode.app/Contents/MacOS/ZCode",
    "/opt/ZCode/zcode",
  ]) { super(); }

  metadata() {
    return { id: "zcode", name: "ZCode", version: "0.1.0", role: "harness" as const,
      vendor: "Z.ai", homepage: "https://zcode.z.ai/en/docs/agents", experimental: true };
  }

  async detect(): Promise<DetectionResult> {
    const installed = this.candidates.find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
    return { status: "unavailable", reason: `${installed ? "Desktop found. " : "Desktop not found in checked locations. "}${ZCODE_LIMITATION}`,
      notes: ["No runtime redistributed. Authentication, models, structured output and session resume are not verified."] };
  }

  protected async buildCapabilities() {
    return { ...emptyManifest("subprocess"), experimental: true,
      limitations: [ZCODE_LIMITATION, "Workspace discovery, session resume and structured output are unavailable."],
      auth: { required: true, authenticated: false, checked: false },
      facts: { executionVerified: false, runtimeRedistributed: false } };
  }

  override async setup() { return { ok: false, status: "unavailable" as const, message: ZCODE_LIMITATION }; }
  async getActiveContext(): Promise<null> { return null; }
  async createSession(): Promise<never> { return this.unsupported(ZCODE_LIMITATION); }
  async attachSession(): Promise<never> { return this.unsupported("session.attach"); }
  async execute(): Promise<never> { return this.unsupported(ZCODE_LIMITATION); }
  async *events(): AsyncIterable<HarnessEvent> { return this.unsupported("stream.events"); }
  async cancel(): Promise<void> {}
  async close(): Promise<void> {}
}

export function createZCodeHarness(): ZCodeHarnessAdapter { return new ZCodeHarnessAdapter(); }
