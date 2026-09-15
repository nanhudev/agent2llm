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
 * OAuth 2.1 authorization server store — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/auth/store.ts
 *   changes:  token prefixes a2l_*, scopes re-scoped to Agent2LLM surfaces,
 *             per-installation storage, `sessionId` binding added.
 *   Original: Copyright (c) 2025 XiaoDuoYa — MIT License.
 *
 * Security properties preserved verbatim: opaque high-entropy tokens,
 * SHA-256-only persistence, one-time authorization codes, refresh rotation.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "@agent2llm/config";

export const SUPPORTED_SCOPES = [
  "workspace.read",
  "workspace.search",
  "git.read",
  "execution.read",
  "offline_access",
] as const;

export type Scope = (typeof SUPPORTED_SCOPES)[number];

export interface ClientRegistration {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  createdAt: string;
}

export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  workspaceId: string;
  sessionId?: string;
  pairingSessionId: string;
  resource?: string;
  expiresAt: number;
}

export interface TokenRecord {
  hash: string;
  kind: "access" | "refresh";
  clientId: string;
  workspaceId: string;
  sessionId?: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

interface PersistedAuthState {
  clients: ClientRegistration[];
  tokens: TokenRecord[];
}

export type VerifyTokenResult =
  | { ok: true; record: TokenRecord }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "wrong_kind" };

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export class AuthStore {
  private clients = new Map<string, ClientRegistration>();
  private tokens = new Map<string, TokenRecord>();
  private authCodes = new Map<string, AuthorizationCodeRecord>();
  readonly file: string;

  constructor(
    readonly workspaceId: string,
    opts: { file?: string } = {}
  ) {
    this.file =
      opts.file ?? path.join(ensureDir(path.join(getStateDir(), "auth")), `${workspaceId}.json`);
    this.load();
  }

  private load(): void {
    const data = readJsonIfExists<PersistedAuthState>(this.file);
    if (!data) return;
    const now = Date.now();
    for (const client of data.clients ?? []) this.clients.set(client.clientId, client);
    for (const token of data.tokens ?? []) {
      if (!token.revoked && token.expiresAt > now) this.tokens.set(token.hash, token);
    }
  }

  private save(): void {
    const now = Date.now();
    const state: PersistedAuthState = {
      clients: [...this.clients.values()],
      tokens: [...this.tokens.values()].filter((token) => !token.revoked && token.expiresAt > now),
    };
    writeSecureJson(this.file, state);
  }

  registerClient(input: { clientName?: string; redirectUris: string[] }): ClientRegistration {
    const client: ClientRegistration = {
      clientId: `a2l_client_${randomBytes(12).toString("base64url")}`,
      ...(input.clientName ? { clientName: input.clientName } : {}),
      redirectUris: input.redirectUris,
      createdAt: new Date().toISOString(),
    };
    this.clients.set(client.clientId, client);
    this.save();
    return client;
  }

  getClient(clientId: string): ClientRegistration | undefined {
    return this.clients.get(clientId);
  }

  createAuthorizationCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
    pairingSessionId: string;
    sessionId?: string;
    resource?: string;
  }): string {
    const code = newToken("a2l_ac");
    this.authCodes.set(code, {
      code,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scopes: input.scopes,
      workspaceId: this.workspaceId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      pairingSessionId: input.pairingSessionId,
      ...(input.resource ? { resource: input.resource } : {}),
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });
    return code;
  }

  /** One-time consumption. A replayed code resolves to null. */
  consumeAuthorizationCode(code: string): AuthorizationCodeRecord | null {
    const record = this.authCodes.get(code);
    if (!record) return null;
    this.authCodes.delete(code);
    if (Date.now() > record.expiresAt) return null;
    return record;
  }

  issueTokens(input: {
    clientId: string;
    scopes: string[];
    workspaceId?: string;
    sessionId?: string;
    accessTtlMs?: number;
  }): { accessToken: string; refreshToken: string | null; expiresIn: number; scopes: string[] } {
    const now = Date.now();
    const workspaceId = input.workspaceId ?? this.workspaceId;
    const accessTtl = input.accessTtlMs ?? ACCESS_TOKEN_TTL_MS;

    const accessToken = newToken("a2l_at");
    this.tokens.set(sha256hex(accessToken), {
      hash: sha256hex(accessToken),
      kind: "access",
      clientId: input.clientId,
      workspaceId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      scopes: input.scopes,
      issuedAt: now,
      expiresAt: now + accessTtl,
      revoked: false,
    });

    let refreshToken: string | null = null;
    if (input.scopes.includes("offline_access")) {
      refreshToken = newToken("a2l_rt");
      this.tokens.set(sha256hex(refreshToken), {
        hash: sha256hex(refreshToken),
        kind: "refresh",
        clientId: input.clientId,
        workspaceId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        scopes: input.scopes,
        issuedAt: now,
        expiresAt: now + REFRESH_TOKEN_TTL_MS,
        revoked: false,
      });
    }
    this.save();
    return { accessToken, refreshToken, expiresIn: Math.floor(accessTtl / 1000), scopes: input.scopes };
  }

  verifyAccessToken(token: string): VerifyTokenResult {
    const record = this.tokens.get(sha256hex(token));
    if (!record) return { ok: false, reason: "unknown" };
    if (record.kind !== "access") return { ok: false, reason: "wrong_kind" };
    if (record.revoked) return { ok: false, reason: "revoked" };
    if (Date.now() > record.expiresAt) return { ok: false, reason: "expired" };
    return { ok: true, record };
  }

  /** Refresh-token rotation: the old refresh token dies on every use. */
  refresh(
    refreshToken: string,
    clientId: string
  ):
    | { ok: true; tokens: ReturnType<AuthStore["issueTokens"]> }
    | { ok: false; reason: string } {
    const record = this.tokens.get(sha256hex(refreshToken));
    if (!record || record.kind !== "refresh") return { ok: false, reason: "invalid_grant" };
    if (record.revoked) return { ok: false, reason: "invalid_grant" };
    if (Date.now() > record.expiresAt) return { ok: false, reason: "invalid_grant" };
    if (record.clientId !== clientId) return { ok: false, reason: "invalid_client" };
    record.revoked = true;
    this.tokens.delete(record.hash);
    const tokens = this.issueTokens({
      clientId,
      scopes: record.scopes,
      workspaceId: record.workspaceId,
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    });
    return { ok: true, tokens };
  }

  revokeToken(token: string): boolean {
    const record = this.tokens.get(sha256hex(token));
    if (!record) return false;
    record.revoked = true;
    this.tokens.delete(record.hash);
    this.save();
    return true;
  }

  revokeAll(): number {
    const count = this.tokens.size;
    this.tokens.clear();
    this.authCodes.clear();
    this.save();
    return count;
  }

  tokenCount(): number {
    return this.tokens.size;
  }

  clientCount(): number {
    return this.clients.size;
  }

  static deleteStateFile(workspaceId: string): void {
    const file = path.join(getStateDir(), "auth", `${workspaceId}.json`);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // ignore
    }
  }
}

export function filterScopes(requested: string | undefined): string[] {
  if (!requested || requested.trim() === "") return [...SUPPORTED_SCOPES];
  const asked = requested.split(/[\s+]+/).filter(Boolean);
  const granted = asked.filter((scope) => (SUPPORTED_SCOPES as readonly string[]).includes(scope));
  return granted.length > 0 ? granted : [...SUPPORTED_SCOPES];
}
