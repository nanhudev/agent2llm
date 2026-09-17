/**
 * Token usage records.
 *
 * The Brain is the only side of the collaboration that spends tokens per
 * thought, and it only thinks during inspect / plan / review — the Harness
 * executes without consulting a model at all. Recording each Brain turn is
 * therefore also recording where the money goes, which is what makes the
 * separation measurable instead of a claim.
 *
 * One honest limitation is structural: a web Brain (ChatGPT in a browser) is
 * subscription-metered and reports nothing, so it records no usage. Nothing is
 * fabricated to fill that gap.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureDir, getStateDir } from "@agent2llm/config";

/** The workflow phase a Brain turn belongs to. Kept coarse on purpose. */
export const USAGE_PHASES = ["inspect", "plan", "review", "revise", "other"] as const;
export type UsagePhase = (typeof USAGE_PHASES)[number];

export function isUsagePhase(value: unknown): value is UsagePhase {
  return typeof value === "string" && (USAGE_PHASES as readonly string[]).includes(value);
}

/**
 * Maps the A2L state that prompted a Brain turn onto the usage phase.
 *
 * `INSPECTING` turns into a plan, `EXECUTED` into a review: the state names the
 * run's position, the phase names what the model spent tokens on.
 */
export function phaseForState(state: string): UsagePhase {
  switch (state) {
    case "INIT":
    case "INSPECTING":
      return "inspect";
    case "PLAN":
      return "plan";
    case "EXECUTED":
    case "REVIEWING":
      return "review";
    case "REVISE":
      return "revise";
    default:
      return "other";
  }
}

export const usageEntrySchema = z.object({
  sessionId: z.string().min(1).max(64),
  /** Which Brain adapter spent the tokens ("api", ...). */
  brainId: z.string().min(1).max(64),
  phase: z.enum(USAGE_PHASES),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  model: z.string().max(120).optional(),
  timestamp: z.string().max(40),
});

export type UsageEntry = z.infer<typeof usageEntrySchema>;

export function usageDir(): string {
  return ensureDir(path.join(getStateDir(), "usage"));
}

export function usageFile(sessionId: string): string {
  return path.join(usageDir(), `${sessionId}.jsonl`);
}

/**
 * Appends one Brain turn. Writing is best-effort: metrics must never be able
 * to fail a run.
 */
export function recordBrainUsage(entry: UsageEntry): UsageEntry {
  const parsed = usageEntrySchema.parse(entry);
  try {
    fs.appendFileSync(usageFile(entry.sessionId), `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
  } catch {
    // A read-only state directory or a full disk should not kill the run.
  }
  return parsed;
}

export function readSessionUsage(sessionId: string): UsageEntry[] {
  return readUsageFile(usageFile(sessionId));
}

/** Reads every recorded session. Used by `agent2llm report`. */
export function readAllUsage(): { sessionId: string; entries: UsageEntry[] }[] {
  const dir = usageDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const sessionId = file.slice(0, -".jsonl".length);
      return { sessionId, entries: readUsageFile(path.join(dir, file)) };
    })
    .filter((s) => s.entries.length > 0);
}

function readUsageFile(file: string): UsageEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: UsageEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = usageEntrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // skip corrupt lines, same as execution records
    }
  }
  return entries;
}

export interface UsageSummary {
  sessions: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  /** Turns per phase — where the thinking budget actually went. */
  phases: Record<UsagePhase, number>;
  brains: string[];
}

/**
 * Aggregates entries into the numbers a report prints.
 *
 * The only rows that can appear are ones a Brain's provider reported. A Harness
 * does not appear in one — not because it spends nothing, but because its own
 * model usage is not observable from outside: it may well be running its own
 * model on its own subscription while it executes. The absence of a Harness row
 * is therefore an absence of data, and must never be read as a measured zero.
 */
export function summarizeUsage(sessions: { entries: UsageEntry[] }[]): UsageSummary {
  const phases: Record<UsagePhase, number> = { inspect: 0, plan: 0, review: 0, revise: 0, other: 0 };
  const brains = new Set<string>();
  let turns = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const session of sessions) {
    for (const entry of session.entries) {
      turns += 1;
      promptTokens += entry.promptTokens;
      completionTokens += entry.completionTokens;
      phases[entry.phase] += 1;
      brains.add(entry.brainId);
    }
  }
  return {
    sessions: sessions.length,
    turns,
    promptTokens,
    completionTokens,
    phases,
    brains: [...brains].sort(),
  };
}
