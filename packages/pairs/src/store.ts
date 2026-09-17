/**
 * Persistence for pairs and runs.
 *
 * JSON files in the machine state directory, one file per entity — no
 * database, no schema migration, no service. A pair is something a user edits
 * by hand if they want to, and a corrupted file must be reportable rather than
 * fatal.
 *
 * The store's other job is refusal: pairs hold adapter-owned opaque refs, and
 * an adapter that puts a bearer token in there would silently turn this
 * directory into a credential store. `assertSecretFree` runs on every write and
 * rejects the record instead.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, removeIfExists, writeSecureJson } from "@agent2llm/config";
import { protocolViolation } from "@agent2llm/core";
import {
  executionReceiptSchema,
  MAX_RECEIPTS_PER_RUN,
  pairSchema,
  runRecordSchema,
  type ExecutionReceipt,
  type Pair,
  type RunRecord,
} from "./model.js";

function stateSubdir(name: string): string {
  return ensureDir(path.join(getStateDir(), name));
}

export function pairsDir(): string {
  return stateSubdir("pairs");
}

export function runsDir(): string {
  return stateSubdir("runs");
}

// ---- secret refusal ---------------------------------------------------------

/**
 * Field names that never belong in a pair or run record.
 *
 * Deliberately broad: a false positive costs one confusing error message, a
 * false negative writes a live credential to disk in a file the user is
 * invited to inspect.
 */
const FORBIDDEN_KEY = /(api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|^token$|secret|password|passwd|credential|cookie|authorization|^auth$|bearer|private[-_]?key|client[-_]?secret)/i;

/** Value shapes that are credentials regardless of what field they sit in. */
const FORBIDDEN_VALUE = [
  /^sk-[A-Za-z0-9_-]{16,}/,
  /^npm_[A-Za-z0-9]{20,}/,
  /^gh[pousr]_[A-Za-z0-9]{20,}/,
  /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Walks a record and throws on the first credential-shaped entry.
 *
 * Exported because the same rule has to be testable without a state
 * directory, and because adapters are the ones who get this wrong.
 */
export function assertSecretFree(value: unknown, trail = "$"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${trail}[${index}]`));
    return;
  }
  if (typeof value !== "object") {
    if (typeof value === "string" && FORBIDDEN_VALUE.some((pattern) => pattern.test(value.trim()))) {
      throw protocolViolation(
        `Refusing to persist a credential-shaped value at ${trail}. Pairs and runs store opaque refs only; ` +
          "credentials belong in the adapter that owns them."
      );
    }
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw protocolViolation(
        `Refusing to persist field '${key}' at ${trail}. Pairs and runs must not contain credential material.`
      );
    }
    assertSecretFree(item, `${trail}.${key}`);
  }
}

// ---- pairs ------------------------------------------------------------------

/** Pair persistence. Reads are tolerant, writes are strict. */
export class PairStore {
  constructor(private readonly dir: string = pairsDir()) {}

  private file(pairId: string): string {
    return path.join(this.dir, `${pairId}.json`);
  }

  save(pair: Pair): Pair {
    // Checked *before* parsing on purpose. Zod strips unknown keys, so a
    // credential in a field the schema does not know about would be dropped in
    // silence — safe today, but it turns "the adapter tried to store a token"
    // into a non-event, and the day that field name becomes legitimate the
    // token starts being persisted. A refusal is louder and stays true.
    assertSecretFree(pair);
    const parsed = pairSchema.parse(pair);
    assertSecretFree(parsed);
    ensureDir(this.dir);
    writeSecureJson(this.file(parsed.pairId), parsed);
    return parsed;
  }

  get(pairId: string): Pair | null {
    const raw = readJsonIfExists<unknown>(this.file(pairId));
    if (!raw) return null;
    const parsed = pairSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** A file that exists but does not parse. Reported, never silently ignored. */
  corrupted(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .filter((file) => !pairSchema.safeParse(readJsonIfExists<unknown>(path.join(this.dir, file))).success)
      .map((file) => path.join(this.dir, file));
  }

  list(): Pair[] {
    if (!fs.existsSync(this.dir)) return [];
    const pairs: Pair[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const parsed = pairSchema.safeParse(readJsonIfExists<unknown>(path.join(this.dir, file)));
      if (parsed.success) pairs.push(parsed.data);
    }
    return pairs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  remove(pairId: string): boolean {
    const file = this.file(pairId);
    const existed = fs.existsSync(file);
    removeIfExists(file);
    return existed;
  }

  /**
   * The pair a bare `a2l run "<goal>"` should use.
   *
   * Most recently *used*, not most recently created: a user with three pairs
   * who runs the second one expects the second one again.
   */
  active(): Pair | null {
    const pairs = this.list();
    if (pairs.length === 0) return null;
    return [...pairs].sort((a, b) => (b.lastRunAt ?? b.updatedAt).localeCompare(a.lastRunAt ?? a.updatedAt))[0]!;
  }
}

// ---- runs -------------------------------------------------------------------

/** Run persistence. Receipts are stored; diffs never are. */
export class RunStore {
  constructor(private readonly dir: string = runsDir()) {}

  private file(runId: string): string {
    return path.join(this.dir, `${runId}.json`);
  }

  save(run: RunRecord): RunRecord {
    assertSecretFree(run);
    const parsed = runRecordSchema.parse(run);
    assertSecretFree(parsed);
    ensureDir(this.dir);
    writeSecureJson(this.file(parsed.runId), parsed);
    return parsed;
  }

  get(runId: string): RunRecord | null {
    const raw = readJsonIfExists<unknown>(this.file(runId));
    if (!raw) return null;
    const parsed = runRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  list(): RunRecord[] {
    if (!fs.existsSync(this.dir)) return [];
    const runs: RunRecord[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const parsed = runRecordSchema.safeParse(readJsonIfExists<unknown>(path.join(this.dir, file)));
      if (parsed.success) runs.push(parsed.data);
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  byPair(pairId: string): RunRecord[] {
    return this.list().filter((run) => run.pairId === pairId);
  }

  /** Runs that never reached a terminal status — the ones a resume cares about. */
  unfinished(): RunRecord[] {
    return this.list().filter((run) => run.status === "running");
  }

  appendReceipt(runId: string, receipt: ExecutionReceipt): RunRecord | null {
    const run = this.get(runId);
    if (!run) return null;
    const parsed = executionReceiptSchema.parse(receipt);
    run.receipts = [...run.receipts, parsed].slice(-MAX_RECEIPTS_PER_RUN);
    return this.save(run);
  }
}
