/**
 * `agent2llm report` — what the Brain actually spent.
 *
 * The Brain's provider usage is the only usage here, because it is the only
 * usage Agent2LLM can measure. The Harness is *absent*, not zero: a harness
 * such as Codex or Cursor may be running its own model on its own subscription
 * while it executes, and nothing in the protocol lets Agent2LLM observe that.
 * Unknown is reported as unknown.
 *
 * Web Brains (ChatGPT, Claude in a browser) are subscription-metered and
 * report nothing, so they contribute nothing here either. No estimate is
 * invented for them; the report only prints what a provider actually billed.
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
  ui.line(ui.dim("Harness usage is not shown, because no harness adapter reported any."));
  ui.line(ui.dim("A harness may spend its own model budget Agent2LLM cannot see. That is unknown, not zero."));
}

function describePhases(phases: Record<string, number>): string {
  const parts = Object.entries(phases)
    .filter(([, count]) => count > 0)
    .map(([phase, count]) => `${phase} ${count}`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}
