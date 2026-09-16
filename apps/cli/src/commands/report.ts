/**
 * `agent2llm report` — what the Brain actually spent.
 *
 * This is the measurement behind the architecture's claim: the Brain is the
 * only side that burns tokens, and it only thinks during inspect / plan /
 * review. The Harness executes without consulting a model, which is why it
 * never appears in a usage file — that absence is the number.
 *
 * Web Brains (ChatGPT, Claude in a browser) are subscription-metered and
 * report nothing, so they contribute nothing here. No estimate is invented
 * for them; the report only prints what a provider actually billed.
 */
import { readAllUsage, summarizeUsage } from "@agent2llm/metrics";
import * as ui from "../ui.js";

export function runReport(options: { json?: boolean } = {}): void {
  const sessions = readAllUsage();

  if (sessions.length === 0) {
    ui.line("No usage recorded yet.");
    ui.line(ui.dim("Usage is written by API-brain runs; web brains are subscription-metered and report nothing."));
    return;
  }

  const summary = summarizeUsage(sessions);

  if (options.json) {
    ui.jsonOutput({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        entries: session.entries,
      })),
      totals: summary,
    });
    return;
  }

  ui.heading("Token usage");
  for (const session of sessions) {
    const s = summarizeUsage([session]);
    ui.line(`  ${session.sessionId}`);
    ui.line(
      `    turns ${s.turns} · prompt ${s.promptTokens.toLocaleString()} tok · completion ${s.completionTokens.toLocaleString()} tok`
    );
    ui.line(`    phases ${describePhases(s.phases)} · brain ${s.brains.join(", ")}`);
  }

  ui.line("");
  ui.line(`  Totals across ${summary.sessions} session${summary.sessions === 1 ? "" : "s"}`);
  ui.line(`    brain turns   ${summary.turns}`);
  ui.line(`    prompt        ${summary.promptTokens.toLocaleString()} tok`);
  ui.line(`    completion    ${summary.completionTokens.toLocaleString()} tok`);
  ui.line(`    phases        ${describePhases(summary.phases)}`);
  ui.line("");
  ui.line(ui.dim("The harness side of these runs spent 0 brain tokens by construction:"));
  ui.line(ui.dim("execution never consults a model, so no usage exists to record."));
}

function describePhases(phases: Record<string, number>): string {
  const parts = Object.entries(phases)
    .filter(([, count]) => count > 0)
    .map(([phase, count]) => `${phase} ${count}`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}
