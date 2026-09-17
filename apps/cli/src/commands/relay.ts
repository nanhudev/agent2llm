/**
 * `a2l run "<goal>"` in Relay Mode — the conversation-centric path.
 *
 * This is the product's headline command. Everything else in the CLI is
 * setup for it: a Pair exists, so this finds it, asks the Harness where it is
 * working, and hands the Brain a thread that survives the run.
 *
 * It is deliberately *not* the legacy `--brain X --harness Y` path. Those flags
 * still mean "start a brain-hands session and let the orchestrator pick the
 * workflow", which is a different promise (the Brain reviews raw evidence, the
 * Harness writes reports), and a user who typed them does not want a surprise.
 * The switch is therefore explicit in both directions:
 *
 *   a2l run "goal"                      → relay, active pair
 *   a2l run "goal" --pair <id>          → relay, that pair
 *   a2l run "goal" --relay --brain B --harness H
 *                                       → relay, find-or-create the pair
 *   a2l run --brain B --harness H       → brain-hands, unchanged
 *
 * What is left in this file is the terminal rendering. The resolution and the
 * run itself live in `relay-goal.ts`, because `a2l dock` starts runs through
 * that same path and a second copy of the resolution rules would drift.
 */
import type { AdapterRegistry, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { RelayRunResult } from "@agent2llm/orchestrator";
import { runRelayGoal, type RelayOptions } from "./relay-goal.js";
import * as ui from "../ui.js";

export type { RelayOptions };

/** Bytes, in the units a human reads. Shared with nothing: it is two lines. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportMetrics(result: RelayRunResult): void {
  const m = result.metrics;
  const tokens = m.brainTokens;
  ui.line();
  ui.line(
    `  ${ui.bold(result.runId)} · ${result.status} · ${result.iterations} execution(s) · ` +
      `${(m.elapsedMs / 1000).toFixed(1)}s`
  );
  ui.line(`    conversation: ${result.conversation.reused ? "continued from the previous run" : "new thread"}`);
  ui.line(`    files changed: ${m.filesChanged}${m.revisions > 0 ? ` · revisions: ${m.revisions}` : ""}`);
  ui.line(
    `    brain tokens: ${tokens === null ? "unknown (not measured)" : tokens.source === "provider-reported" ? String(tokens.promptTokens + tokens.completionTokens) : `unavailable — ${tokens.reason}`}`
  );
  // Labelled "estimated text" on purpose: these are byte counts divided by four,
  // not a provider's billing counter, and calling them tokens would be a lie
  // that looks like a measurement.
  ui.line(
    ui.dim(
      `    text to harness: ${formatBytes(m.harnessInstruction.bytes)} (≈${m.harnessInstruction.estimatedTextTokens} estimated text tokens)` +
        ` · from harness: ${formatBytes(m.harnessResponse.bytes)}`
    )
  );
  ui.line(
    ui.dim(
      `    text to brain: ${formatBytes(m.brainPrompt.bytes)} (≈${m.brainPrompt.estimatedTextTokens} estimated text tokens)` +
        ` · from brain: ${formatBytes(m.brainResponse.bytes)}`
    )
  );
  const saved = m.evidenceRaw.bytes - m.evidenceCompact.bytes;
  ui.line(
    ui.dim(
      `    evidence: ${formatBytes(m.evidenceRaw.bytes)} collected → ${formatBytes(m.evidenceCompact.bytes)} sent` +
        (saved > 0 ? ` (${formatBytes(saved)} kept out of the conversation)` : "")
    )
  );
}

export async function runRelay(registry: AdapterRegistry, options: RelayOptions): Promise<number> {
  const events: string[] = [];
  const goal = options.goal ?? (await ui.promptText("Goal"));
  if (goal.trim() === "") {
    ui.warn("No goal supplied; nothing to do.");
    return 0;
  }

  // A holder rather than a `let`: the spinner is created inside a callback, and
  // TypeScript narrows a `let` that is only assigned there to `never`.
  const progress: { spinner: ui.Spinner | null } = { spinner: null };
  let outcome: Awaited<ReturnType<typeof runRelayGoal>>;
  try {
    outcome = await runRelayGoal(registry, { ...options, goal }, {
      // The header goes out before the first dispatch, not after the run: a
      // user watching a five-minute execution needs to know which pair and
      // which folder they are watching while it happens.
      onResolved: ({ pair, context, notes }) => {
        if (!options.json) {
          ui.heading(`Relay — ${pair.brainAdapterId} × ${pair.harnessAdapterId}`);
          ui.line(ui.dim(`pair:    ${pair.label ? `${pair.label} (${pair.pairId})` : pair.pairId}`));
          ui.line(ui.dim(`context: ${context?.root ?? "(none)"} [${context?.source ?? "unresolved"}]`));
          ui.line(ui.dim(`policy:  ${pair.executionPolicy.mode} — the harness executes, it does not plan`));
          for (const note of notes) ui.line(ui.dim(`note:    ${note}`));
          if (options.ignoreAuth) {
            ui.line(
              ui.dim("note:    --ignore-auth is not used by Relay Mode; each adapter keeps its own sign-in state.")
            );
          }
          ui.line();
        }
        progress.spinner = ui.spinner("Talking to the brain");
      },
      onEvent: (line) => {
        events.push(line);
        if (!options.json) ui.line(`  ${line}`);
      },
      requestUserAction: (action: UserActionRequest) => ui.requestUserAction(action),
    });
  } catch (err) {
    progress.spinner?.stop();
    ui.errorOutput(err);
    return 1;
  }
  progress.spinner?.stop();

  if (!outcome.ok) {
    ui.fail(outcome.error);
    return 2;
  }

  const { result } = outcome;
  if (options.json) {
    ui.jsonOutput({
      ...result,
      pairId: result.pairId,
      context: outcome.context?.root ?? null,
      notes: outcome.notes,
      events,
    });
    return result.status === "done" ? 0 : 1;
  }

  ui.line(`  ${result.status === "done" ? ui.green("✓") : ui.yellow("!")} ${result.summary}`);
  reportMetrics(result);
  return result.status === "done" ? 0 : 1;
}
