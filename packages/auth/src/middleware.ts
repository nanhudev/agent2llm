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
 * Bearer guard for the MCP endpoint — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/auth/middleware.ts
 *   changes:  realm renamed, session binding enforced, 403 on session mismatch.
 */
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "@agent2llm/logger";
import type { AuthStore } from "./store.js";

export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  workspaceId: string;
  sessionId?: string;
}

export interface BearerAuthDeps {
  store: AuthStore;
  workspaceId: string;
  /** When set, tokens minted for another collaboration session are rejected. */
  sessionId?: string;
  getBaseUrl: (req: Request) => string;
  logger: Logger;
}

export function bearerAuth(deps: BearerAuthDeps) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const challenge = (error: string, description: string): string =>
      `Bearer realm="agent2llm", error="${error}", error_description="${description}", ` +
      `resource_metadata="${deps.getBaseUrl(req)}/.well-known/oauth-protected-resource/mcp"`;

    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      res
        .status(401)
        .set("WWW-Authenticate", challenge("invalid_token", "Missing bearer token"))
        .json({ error: "unauthorized", error_description: "Authentication required" });
      return;
    }
    const token = header.slice(7).trim();
    const verdict = deps.store.verifyAccessToken(token);
    if (!verdict.ok) {
      deps.logger.warn(`Rejected MCP request: token ${verdict.reason}`);
      res
        .status(401)
        .set("WWW-Authenticate", challenge("invalid_token", `Token ${verdict.reason}`))
        .json({ error: "unauthorized", error_description: `Token ${verdict.reason}` });
      return;
    }
    if (verdict.record.workspaceId !== deps.workspaceId) {
      deps.logger.warn("Rejected MCP request: token bound to a different workspace");
      res.status(403).json({
        error: "forbidden",
        error_description: "This token is not authorized for the connected workspace",
      });
      return;
    }
    if (deps.sessionId && verdict.record.sessionId && verdict.record.sessionId !== deps.sessionId) {
      deps.logger.warn("Rejected MCP request: token bound to a different session");
      res.status(403).json({
        error: "forbidden",
        error_description: "This token is not authorized for the current collaboration session",
      });
      return;
    }
    const authInfo: AuthInfo = {
      token,
      clientId: verdict.record.clientId,
      scopes: verdict.record.scopes,
      expiresAt: Math.floor(verdict.record.expiresAt / 1000),
      workspaceId: verdict.record.workspaceId,
      ...(verdict.record.sessionId ? { sessionId: verdict.record.sessionId } : {}),
    };
    (req as Request & { auth?: AuthInfo }).auth = authInfo;
    next();
  };
}

export function requireScope(authInfo: AuthInfo | undefined, scope: string): string | null {
  // authInfo is absent only for trusted in-process clients (tests / local stdio).
  if (!authInfo) return null;
  return authInfo.scopes.includes(scope) ? null : `This operation requires the '${scope}' scope.`;
}
