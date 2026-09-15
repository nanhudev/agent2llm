/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
/**
 * Pairing manager — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/pairing/manager.ts
 *   changes:  renamed product prefixes, extracted options, added `peek()`,
 *             deterministic injectable clock, unchanged security properties.
 *   Original: Copyright (c) 2025 XiaoDuoYa — MIT License.
 *             See THIRD_PARTY_NOTICES.md.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface PairingSession {
  id: string;
  codeHash: Buffer;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
  used: boolean;
}

export type PairingVerifyResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "too_many_attempts" | "rate_limited" | "no_active_session";
      attemptsLeft?: number;
    };

// No ambiguous characters (I, L, O, 0, 1).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 8): string {
  const chars: string[] = [];
  while (chars.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      // rejection sampling for uniformity
      if (byte < Math.floor(256 / ALPHABET.length) * ALPHABET.length) {
        chars.push(ALPHABET[byte % ALPHABET.length]!);
        if (chars.length === length) break;
      }
    }
  }
  return chars.join("");
}

function hashCode(code: string): Buffer {
  return createHash("sha256").update(code).digest();
}

export function formatPairingCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export interface PairingManagerOptions {
  ttlMs?: number;
  maxAttempts?: number;
  ipRateLimit?: number;
  ipRateWindowMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class PairingManager {
  private sessions = new Map<string, PairingSession>();
  private ipHits = new Map<string, { count: number; resetAt: number }>();
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly ipRateLimit: number;
  private readonly ipRateWindowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly workspaceId: string,
    opts: PairingManagerOptions = {}
  ) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.ipRateLimit = opts.ipRateLimit ?? 10;
    this.ipRateWindowMs = opts.ipRateWindowMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Create a pairing session; invalidates any previous one (one active at a time). */
  create(): { sessionId: string; code: string; expiresAt: number } {
    this.sessions.clear();
    const raw = generateCode();
    const session: PairingSession = {
      id: randomBytes(16).toString("hex"),
      codeHash: hashCode(raw),
      workspaceId: this.workspaceId,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      attemptsLeft: this.maxAttempts,
      used: false,
    };
    this.sessions.set(session.id, session);
    return { sessionId: session.id, code: formatPairingCode(raw), expiresAt: session.expiresAt };
  }

  private checkIpRate(ip: string | undefined): boolean {
    if (!ip) return true;
    const now = this.now();
    const entry = this.ipHits.get(ip);
    if (!entry || now > entry.resetAt) {
      this.ipHits.set(ip, { count: 1, resetAt: now + this.ipRateWindowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.ipRateLimit;
  }

  verify(codeInput: string, ip?: string): PairingVerifyResult {
    if (!this.checkIpRate(ip)) return { ok: false, reason: "rate_limited" };
    const normalized = normalizePairingCode(codeInput);
    const inputHash = hashCode(normalized);
    const now = this.now();

    const active = [...this.sessions.values()].filter((session) => !session.used);
    if (active.length === 0) return { ok: false, reason: "no_active_session" };

    for (const session of active) {
      if (now > session.expiresAt) {
        this.sessions.delete(session.id);
        return { ok: false, reason: "expired" };
      }
      if (session.attemptsLeft <= 0) {
        this.sessions.delete(session.id);
        return { ok: false, reason: "too_many_attempts" };
      }
      if (timingSafeEqual(inputHash, session.codeHash)) {
        session.used = true;
        this.sessions.delete(session.id);
        return { ok: true, sessionId: session.id };
      }
      session.attemptsLeft--;
      if (session.attemptsLeft <= 0) {
        this.sessions.delete(session.id);
        return { ok: false, reason: "too_many_attempts" };
      }
      return { ok: false, reason: "invalid", attemptsLeft: session.attemptsLeft };
    }
    return { ok: false, reason: "no_active_session" };
  }

  hasActiveSession(): boolean {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (!session.used && now <= session.expiresAt) return true;
    }
    return false;
  }

  invalidateAll(): void {
    this.sessions.clear();
  }

  /** Test/telemetry helper: never exposes the code itself. */
  peek(): { active: boolean; sessions: number } {
    return { active: this.hasActiveSession(), sessions: this.sessions.size };
  }
}
