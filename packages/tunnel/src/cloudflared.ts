/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { Logger } from "@agent2llm/logger";
import { tunnelFailure, userActionRequired } from "@agent2llm/core";
import { locateBinary } from "@agent2llm/detect";
import type { TunnelDoctorReport, TunnelProvider, TunnelStatus } from "./provider.js";

const URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/**
 * Cloudflare Quick Tunnel — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/tunnel/cloudflared.ts
 * The URL changes on every start; the CLI/Doctor own connector rotation.
 */
export class CloudflaredQuickTunnel implements TunnelProvider {
  readonly name = "cloudflared-quick";
  private child: ChildProcess | null = null;
  private url: string | null = null;
  private binary: string | null = null;

  constructor(private readonly logger: Logger, binaryPath?: string) {
    if (binaryPath) this.binary = binaryPath;
  }

  private async resolveBinary(): Promise<string> {
    if (this.binary) return this.binary;
    const found = await locateBinary("cloudflared", { probeVersion: false });
    if (!found) {
      throw tunnelFailure("cloudflared was not found. Install it or run with --tunnel none (local-only).", {
        hint: "Install cloudflared, or use a local network tunnel you manage yourself.",
      });
    }
    this.binary = found.path;
    return found.path;
  }

  async start(localPort: number): Promise<string> {
    if (this.url) return this.url;
    const binary = await this.resolveBinary();
    const args = ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"];
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.child = child;

    const url = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => {
        reject(tunnelFailure("Timed out waiting for the Cloudflare tunnel URL."));
      }, 45_000);
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString("utf8");
        const match = URL_PATTERN.exec(buffer);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(tunnelFailure(`cloudflared failed to start: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null && !this.url) {
          reject(tunnelFailure(`cloudflared exited with code ${code}.`));
        }
      });
    });

    this.url = url;
    this.logger.info(`Cloudflare Quick Tunnel ready: ${url}`);
    return url;
  }

  async stop(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        this.child?.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.child = null;
    this.url = null;
  }

  async restart(localPort: number): Promise<string> {
    await this.stop();
    return this.start(localPort);
  }

  status(): TunnelStatus {
    return {
      running: this.url !== null,
      url: this.url,
      provider: this.name,
    };
  }

  getPublicUrl(): string | null {
    return this.url;
  }

  async doctor(): Promise<TunnelDoctorReport> {
    const found = await locateBinary("cloudflared", { probeVersion: false });
    const problems: string[] = [];
    if (!found) problems.push("cloudflared binary not found on PATH or in common locations.");
    return {
      provider: this.name,
      binaryFound: Boolean(found),
      binaryPath: found?.path ?? null,
      running: this.url !== null,
      url: this.url,
      problems,
    };
  }
}

/** No public exposure: loopback only. Used for manual/local Brain adapters. */
export class NoTunnel implements TunnelProvider {
  readonly name = "none";
  async start(localPort: number): Promise<string> {
    return `http://127.0.0.1:${localPort}`;
  }
  async stop(): Promise<void> {
    // nothing to release
  }
  async restart(localPort: number): Promise<string> {
    return this.start(localPort);
  }
  status(): TunnelStatus {
    return { running: false, url: null, provider: this.name, detail: "loopback only" };
  }
  getPublicUrl(): string | null {
    return null;
  }
  async doctor(): Promise<TunnelDoctorReport> {
    return {
      provider: this.name,
      binaryFound: true,
      binaryPath: null,
      running: false,
      url: null,
      problems: [],
    };
  }
}

export function tunnelUnavailableAction(): never {
  throw userActionRequired(
    "No tunnel is available. Install cloudflared, or bring your own tunnel and set --tunnel none for local-only use.",
    { details: { action: { kind: "install", message: "Install cloudflared" } }, retryable: false }
  );
}
