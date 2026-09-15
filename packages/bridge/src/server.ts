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
 * Workspace bridge: loopback HTTP server exposing
 *   - read-only MCP (data plane, OAuth bearer protected)
 *   - OAuth 2.1 authorization server + pairing
 *   - loopback-only admin API for the CLI
 *
 * ADAPTED from codex-with-chatgpt (MIT), upstream src/bridge/server.ts.
 * Changes: session-scoped tokens, explicit public-URL provider injection,
 * multi-workspace aware runtime registry, Agent2LLM naming.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { DEFAULT_HOST, DEFAULT_PORT, PRODUCT_NAME } from "@agent2llm/config";
import type { Logger } from "@agent2llm/logger";
import { nullLogger } from "@agent2llm/logger";
import { Workspace } from "@agent2llm/workspace";
import { WorkspaceRegistry } from "@agent2llm/workspace";
import { AuthStore } from "@agent2llm/auth";
import { createOAuthRouter } from "@agent2llm/auth";
import { bearerAuth } from "@agent2llm/auth";
import { PairingManager } from "@agent2llm/pairing";
import { createMcpServer } from "@agent2llm/mcp";
import { createMcpHttpHandler } from "@agent2llm/mcp";
import type { TunnelProvider } from "@agent2llm/tunnel";
import { NoTunnel } from "@agent2llm/tunnel";
import { SessionStore } from "@agent2llm/session";
import { clearRuntimeState, writeRuntimeState, type RuntimeState } from "./runtime.js";

export interface BridgeOptions {
  workspaceRoot: string;
  port?: number;
  host?: string;
  logger?: Logger;
  tunnelProvider?: TunnelProvider;
  sessionId?: string;
  version?: string;
  persistRuntime?: boolean;
  authStoreFile?: string;
  pairingTtlMs?: number;
  /** Serve the workspace registry in `list_workspaces`. */
  registry?: WorkspaceRegistry;
  sessions?: SessionStore;
}

export interface Bridge {
  workspace: Workspace;
  port: number;
  host: string;
  adminToken: string;
  authStore: AuthStore;
  pairing: PairingManager;
  tunnel: TunnelProvider;
  getPublicBaseUrl(): string | null;
  localBaseUrl(): string;
  close(): Promise<void>;
}

function listen(
  app: express.Express,
  host: string,
  preferredPort: number
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, allowFallback: boolean): void => {
      const server = app.listen(port, host);
      server.once("listening", () => {
        const address = server.address();
        resolve({ server, port: typeof address === "object" && address ? address.port : port });
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && allowFallback) {
          tryListen(0, false);
        } else {
          reject(error);
        }
      });
    };
    tryListen(preferredPort, preferredPort !== 0);
  });
}

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const logger = opts.logger ?? nullLogger;
  const workspace = new Workspace(opts.workspaceRoot);
  const host = opts.host ?? DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("The bridge only binds to loopback. Public exposure goes through a tunnel.");
  }

  const authStore = new AuthStore(workspace.id, { ...(opts.authStoreFile ? { file: opts.authStoreFile } : {}) });
  const pairing = new PairingManager(workspace.id, { ...(opts.pairingTtlMs ? { ttlMs: opts.pairingTtlMs } : {}) });
  const tunnel = opts.tunnelProvider ?? new NoTunnel();
  const adminToken = `a2l_admin_${randomBytes(24).toString("base64url")}`;
  const version = opts.version ?? "0.1.0";
  const mcpVersion = `${version}`;

  let publicBaseUrl: string | null = null;
  let port = opts.port ?? DEFAULT_PORT;

  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  const getBaseUrl = (req: Request): string => {
    if (publicBaseUrl) return publicBaseUrl;
    const hostHeader = req.get("host") ?? `${host}:${port}`;
    return `${req.protocol}://${hostHeader}`;
  };

  app.get("/health", (_req, res) => {
    res.json({ service: "agent2llm", version, workspaceId: workspace.id, status: "ok" });
  });

  app.use(
    createOAuthRouter({
      store: authStore,
      pairing,
      workspaceName: workspace.name,
      productName: PRODUCT_NAME,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      getBaseUrl,
      logger,
    })
  );

  const mcpHandler = createMcpHttpHandler(
    () =>
      createMcpServer({
        workspace,
        logger,
        version: mcpVersion,
        ...(opts.registry ? { registry: opts.registry } : {}),
        ...(opts.sessions ? { sessions: opts.sessions } : {}),
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      }),
    logger
  );

  app.all(
    "/mcp",
    express.json({ limit: "8mb" }),
    bearerAuth({
      store: authStore,
      workspaceId: workspace.id,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      getBaseUrl,
      logger,
    }),
    (req: Request, res: Response) => {
      void mcpHandler(req, res);
    }
  );

  const adminGuard = (req: Request, res: Response, next: NextFunction): void => {
    const remote = req.socket.remoteAddress ?? "";
    const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const viaProxy = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]);
    const header = req.headers.authorization ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!isLoopback || viaProxy || token !== adminToken) {
      res.status(404).end();
      return;
    }
    next();
  };

  app.post("/admin/pairing", adminGuard, (_req, res) => {
    const session = pairing.create();
    res.json({ code: session.code, expiresAt: session.expiresAt });
  });

  app.get("/admin/info", adminGuard, (_req, res) => {
    res.json({
      service: "agent2llm",
      version,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRoot: workspace.root,
      port,
      publicUrl: publicBaseUrl,
      tunnel: tunnel.status(),
      tokenCount: authStore.tokenCount(),
      pairingActive: pairing.hasActiveSession(),
      pid: process.pid,
      startedAt,
    });
  });

  app.post("/admin/tunnel/start", adminGuard, (_req, res) => {
    tunnel
      .start(port)
      .then((url) => {
        publicBaseUrl = url;
        persistRuntime();
        res.json({ url });
      })
      .catch((error: Error) => {
        logger.error(`Tunnel start failed: ${error.message}`);
        res.status(500).json({ error: "tunnel_failed", message: error.message });
      });
  });

  app.post("/admin/tunnel/stop", adminGuard, (_req, res) => {
    void tunnel.stop().then(() => {
      publicBaseUrl = null;
      persistRuntime();
      res.json({ stopped: true });
    });
  });

  app.post("/admin/revoke-all", adminGuard, (_req, res) => {
    const count = authStore.revokeAll();
    pairing.invalidateAll();
    res.json({ revoked: count });
  });

  app.post("/admin/shutdown", adminGuard, (_req, res) => {
    res.json({ shuttingDown: true });
    setTimeout(() => {
      void shutdown().then(() => process.exit(0));
    }, 100);
  });

  const { server, port: actualPort } = await listen(app, host, opts.port ?? DEFAULT_PORT);
  port = actualPort;
  const startedAt = new Date().toISOString();
  logger.info(`Bridge listening on ${host}:${port} for workspace ${workspace.name} (${workspace.id})`);

  const persistRuntime = (): void => {
    if (opts.persistRuntime === false) return;
    const state: RuntimeState = {
      service: "agent2llm",
      version,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      pid: process.pid,
      port,
      adminToken,
      publicUrl: publicBaseUrl,
      startedAt,
    };
    writeRuntimeState(state);
  };
  persistRuntime();

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await tunnel.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (opts.persistRuntime !== false) clearRuntimeState(workspace.id);
    logger.info("Bridge stopped");
  };

  return {
    workspace,
    port,
    host,
    adminToken,
    authStore,
    pairing,
    tunnel,
    getPublicBaseUrl: () => publicBaseUrl,
    localBaseUrl: () => `http://${host}:${port}`,
    close: shutdown,
  };
}
