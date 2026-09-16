/**
 * `agent2llm doctor`.
 *
 * The most important UX surface after `run`. A check must always say what
 * failed, why, and whether an automatic repair exists. UNVERIFIED is a first
 * class result: "we did not check" is never reported as "OK".
 */
import os from "node:os";
import fs from "node:fs";
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { getStateDir, loadMachineConfig } from "@agent2llm/config";
import { findBridgeObservation } from "@agent2llm/bridge";
import { WorkspaceRegistry } from "@agent2llm/workspace";
import { SessionStore } from "@agent2llm/session";
import {
  attachEndpointSource,
  attachRepairHint,
  findAttachEndpoint,
  probeBrowserModule,
  probeDesktopApp,
  resetAttachProbeCache,
} from "@agent2llm/transports";
import * as ui from "../ui.js";
import { registerExternalAdapters } from "../registry.js";

export type CheckResult = "PASS" | "WARN" | "FAIL" | "SKIP" | "UNVERIFIED";

export interface Check {
  name: string;
  result: CheckResult;
  message: string;
  repair?: string;
}

const ORDER: Record<CheckResult, number> = { FAIL: 0, WARN: 1, UNVERIFIED: 2, SKIP: 3, PASS: 4 };

function versionAtLeast(current: string, min: number): boolean {
  const major = Number.parseInt(current.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= min;
}

export async function runDoctor(
  registry: AdapterRegistry,
  options: { json?: boolean; workspace?: string } = {}
): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push({
    name: "Node.js",
    result: versionAtLeast(process.version, 20) ? "PASS" : "FAIL",
    message: `${process.version} on ${os.platform()}/${os.arch()}`,
    ...(versionAtLeast(process.version, 20) ? {} : { repair: "Install Node.js >= 20." }),
  });

  const stateDir = getStateDir();
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    checks.push({ name: "State directory", result: "PASS", message: stateDir });
  } catch (error) {
    checks.push({
      name: "State directory",
      result: "FAIL",
      message: `${stateDir}: ${(error as Error).message}`,
      repair: "Set AGENT2LLM_STATE_DIR to a writable path.",
    });
  }

  const config = loadMachineConfig();
  checks.push({
    name: "Configuration",
    result: "PASS",
    message: `default workflow '${config.defaultWorkflow}', maxIterations ${config.maxIterations}`,
  });

  const browser = probeBrowserModule();
  // A doctor run is an explicit "tell me the state right now". A cached answer
  // from a second ago is precisely what the user is asking us not to trust.
  resetAttachProbeCache();
  const attachSource = attachEndpointSource();
  const attach = await findAttachEndpoint();
  const desktop = await probeDesktopApp();

  // Ordered by preference: attaching to a window the user already has open is
  // the path Web Brains take when it is available, so it is reported first.
  checks.push({
    name: "Window attach",
    result: attach ? "PASS" : "UNVERIFIED",
    message: attach
      ? `Attaching is available at ${attach.endpoint} (${attach.browser ?? "unknown engine"}).`
      : "No DevTools endpoint answered. Web Brains will launch their own browser instead.",
    ...(attach ? {} : { repair: attachRepairHint(attachSource) }),
  });

  const runningLabel =
    desktop.running === true ? " (running)" : desktop.running === false ? " (not running)" : "";
  const profileLabel =
    desktop.profileFiles.length > 0 ? ` · profile ${desktop.profileFiles[0]}` : "";

  checks.push({
    name: "ChatGPT desktop",
    result: desktop.installed ? "PASS" : "UNVERIFIED",
    message: desktop.installed
      ? `${desktop.executables[0]}${runningLabel}${profileLabel}`
      : "Not installed. Install the official app, or keep an Edge/Chrome window open with a DevTools port.",
    ...(desktop.installed && !desktop.endpoint ? { repair: desktop.hint } : {}),
  });

  checks.push({
    name: "Browser automation",
    result: browser.installed ? "PASS" : "UNVERIFIED",
    message: browser.installed
      ? "Playwright is installed; a browser can be launched when no window is there to attach to."
      : "Playwright is not installed. Web Brains cannot launch a browser; the manual transport still works.",
    ...(browser.installed ? {} : { repair: "npm i -D playwright && npx playwright install chromium" }),
  });

  const detections = await registry.detectAll(true);
  for (const detection of detections) {
    const status = detection.detection.status;
    const result: CheckResult =
      status === "detected" || status === "verified"
        ? "PASS"
        : status === "implemented"
          ? "UNVERIFIED"
          : status === "unavailable"
            ? "FAIL"
            : "WARN";
    checks.push({
      name: `Adapter ${detection.id}`,
      result,
      message: detection.detection.reason ?? status,
      ...(result === "PASS"
        ? {}
        : { repair: `Install ${detection.drives ?? detection.name}, then run 'agent2llm detect'.` }),
    });
  }

  const externals = await registerExternalAdapters(registry);
  checks.push({
    name: "External adapters",
    result: config.adapterPackages.length === 0 ? "SKIP" : externals.length === config.adapterPackages.length ? "PASS" : "WARN",
    message:
      config.adapterPackages.length === 0
        ? "No third-party adapter packages configured."
        : `${externals.length}/${config.adapterPackages.length} loaded: ${externals.join(", ") || "none"}`,
  });

  const workspaces = new WorkspaceRegistry();
  const workspaceRoot = options.workspace ?? process.cwd();
  const record = workspaces.ensureCurrent(workspaceRoot);
  checks.push({
    name: "Workspace",
    result: fs.existsSync(record.root) ? "PASS" : "FAIL",
    message: `${record.name} (${record.id}) at ${record.root}`,
  });

  const observation = await findBridgeObservation(record.id);
  checks.push({
    name: "Bridge",
    result:
      observation.state === "healthy"
        ? "PASS"
        : observation.state === "stopped"
          ? "WARN"
          : "UNVERIFIED",
    message:
      observation.state === "healthy"
        ? `healthy on port ${observation.runtime.port}`
        : `${observation.state} (${observation.reason ?? "unknown"})`,
    ...(observation.state === "healthy" ? {} : { repair: "Run 'agent2llm run' — the bridge starts automatically." }),
  });

  const sessions = new SessionStore();
  const active = sessions.active();
  checks.push({
    name: "Sessions",
    result: active.length > 0 ? "WARN" : "PASS",
    message:
      active.length > 0
        ? `${active.length} unfinished session(s). Resume with 'agent2llm session resume <id>'.`
        : "No unfinished sessions.",
  });

  checks.sort((a, b) => ORDER[a.result] - ORDER[b.result]);

  if (options.json) {
    ui.jsonOutput({ checks, summary: summarize(checks) });
    return checks;
  }

  ui.heading("Agent2LLM doctor");
  for (const check of checks) {
    const mark =
      check.result === "PASS"
        ? ui.MARK_OK
        : check.result === "FAIL"
          ? ui.MARK_FAIL
          : check.result === "WARN"
            ? ui.MARK_WARN
            : ui.dim("•");
    ui.line(`  ${mark} ${check.name.padEnd(22)} ${ui.dim(check.result.padEnd(10))} ${check.message}`);
    if (check.repair) ui.line(`      ${ui.dim(`repair: ${check.repair}`)}`);
  }
  const summary = summarize(checks);
  ui.line();
  ui.line(
    `  ${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail · ${summary.unverified} unverified · ${summary.skip} skip`
  );
  ui.line();
  return checks;
}

function summarize(checks: Check[]): Record<string, number> {
  return {
    pass: checks.filter((c) => c.result === "PASS").length,
    warn: checks.filter((c) => c.result === "WARN").length,
    fail: checks.filter((c) => c.result === "FAIL").length,
    unverified: checks.filter((c) => c.result === "UNVERIFIED").length,
    skip: checks.filter((c) => c.result === "SKIP").length,
  };
}
