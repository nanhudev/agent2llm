/**
 * `agent2llm detect` and `agent2llm adapters|brains|harnesses`.
 *
 * Detection is static and bounded: it never launches an agent, and it never
 * scans the disk recursively. Everything is machine-readable via --json so
 * other agents can call it.
 */
import { AdapterRegistry } from "@agent2llm/adapter-sdk";
import * as ui from "../ui.js";

export interface DetectOptions {
  json?: boolean;
  quick?: boolean;
}

export async function runDetect(registry: AdapterRegistry, options: DetectOptions = {}): Promise<void> {
  const results = await registry.detectAll(options.quick ?? true);
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
  }
  ui.line();
}

export async function runAdapters(registry: AdapterRegistry, options: { json?: boolean } = {}): Promise<void> {
  const results = await registry.detectAll(true);
  if (options.json) {
    ui.jsonOutput(results);
    return;
  }
  ui.heading("Adapters");
  ui.line(
    ui.renderTable(
      [
        { header: "ID", width: 18 },
        { header: "ROLE", width: 8 },
        { header: "STATUS", width: 12 },
        { header: "VERSION", width: 22 },
        { header: "DRIVES", width: 16 },
      ],
      results.map((result) => [
        result.id,
        result.role,
        result.detection.status,
        result.detection.version ?? "-",
        result.drives ?? "-",
      ])
    )
  );
  ui.line();
}
