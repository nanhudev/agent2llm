/**
 * `agent2llm detect` and `agent2llm adapters|brains|harnesses`.
 *
 * Detection is bounded: it never launches an agent, and it never scans the
 * disk recursively. Everything is machine-readable via --json so other agents
 * can call it.
 *
 * `--quick` exists for callers that only need "is it installed" and cannot
 * afford a version probe. It is not the default, because a report that shows
 * `version: -` for a binary that answers `--version` in 300 ms is a worse
 * trade than the milliseconds it saves.
 *
 * The `adapters` table has a second honesty duty: the default view shows only
 * what this machine can actually use today. A user who sees eight rows
 * concludes they have eight adapters, and "implemented" is not installed —
 * it is code waiting for a product that is not on this machine. Those rows
 * are one `--all` away, and the filtered-out count is printed, so nothing
 * is hidden silently.
 */
import { AdapterRegistry, type AdapterDetection } from "@agent2llm/adapter-sdk";
import { CLI_PRIMARY_NAME } from "@agent2llm/config";
import * as ui from "../ui.js";

/** Statuses that mean the machine can use this adapter today. */
const READY_STATUSES = new Set(["verified", "detected", "configured", "authenticated"]);

export function isInstalled(result: AdapterDetection): boolean {
  return READY_STATUSES.has(result.detection.status);
}

/** The one split the default view and the dock form both render from. */
export function splitByInstallation(results: readonly AdapterDetection[]): {
  installed: AdapterDetection[];
  needsSetup: AdapterDetection[];
} {
  return {
    installed: results.filter(isInstalled),
    needsSetup: results.filter((result) => !isInstalled(result)),
  };
}

export interface DetectOptions {
  json?: boolean;
  quick?: boolean;
}

export async function runDetect(registry: AdapterRegistry, options: DetectOptions = {}): Promise<void> {
  const results = await registry.detectAll(options.quick ?? false);
  if (options.json) {
    ui.jsonOutput({
      brains: results.filter((r) => r.role === "brain"),
      harnesses: results.filter((r) => r.role === "harness"),
    });
    return;
  }
  ui.heading("Brains");
  for (const result of results.filter((r) => r.role === "brain")) {
    ui.line(`  ${result.detection.status === "implemented" ? ui.MARK_NO : ui.MARK_OK} ${result.name} ${ui.dim(`(${result.id})`)}`);
    if (result.detection.reason) ui.line(`      ${ui.dim(result.detection.reason)}`);
  }
  ui.heading("Harnesses");
  for (const result of results.filter((r) => r.role === "harness")) {
    const mark =
      result.detection.status === "detected" || result.detection.status === "verified"
        ? ui.MARK_OK
        : ui.MARK_NO;
    ui.line(`  ${mark} ${result.name} ${ui.dim(`(${result.id})`)}`);
    if (result.detection.version) ui.line(`      ${ui.dim(result.detection.version)}`);
    if (result.detection.reason) ui.line(`      ${ui.dim(result.detection.reason)}`);
    for (const note of result.detection.notes ?? []) {
      ui.line(`      ${ui.dim(`· ${note}`)}`);
    }
  }
  ui.line();
}

export async function runAdapters(
  registry: AdapterRegistry,
  options: { json?: boolean; quick?: boolean; all?: boolean } = {}
): Promise<void> {
  const results = await registry.detectAll(options.quick ?? false);
  if (options.json) {
    // JSON stays complete: scripts want every entry with its status. The
    // filter below is a rendering choice for humans, never a data one.
    ui.jsonOutput(results);
    return;
  }
  const { installed, needsSetup } = splitByInstallation(results);
  const shown = options.all ? results : installed;
  ui.heading("Adapters");
  if (shown.length === 0) {
    ui.line("  Nothing this CLI can drive is installed on this machine yet.");
    ui.line(`  '${CLI_PRIMARY_NAME} adapters --all' lists everything it knows how to look for.`);
    ui.line();
    return;
  }
  ui.line(
    ui.renderTable(
      [
        { header: "ID", width: 18 },
        { header: "ROLE", width: 8 },
        { header: "STATUS", width: 12 },
        { header: "VERSION", width: 30 },
        { header: "DRIVES", width: 16 },
      ],
      shown.map((result) => [
        result.id,
        result.role,
        result.detection.status,
        // A dash is a claim that there is no version. Say which it is.
        result.detection.version ?? (result.detection.status === "detected" ? "unknown" : "-"),
        result.drives ?? "-",
      ])
    )
  );
  if (!options.all && needsSetup.length > 0) {
    ui.line(
      ui.dim(
        `  ${needsSetup.length} more need setup (not installed here) — '${CLI_PRIMARY_NAME} adapters --all' lists them.`
      )
    );
  }
  ui.line();
}
