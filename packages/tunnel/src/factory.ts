import type { Logger } from "@agent2llm/logger";
import { CloudflaredQuickTunnel, NoTunnel } from "./cloudflared.js";
import type { TunnelProvider } from "./provider.js";

export type TunnelMode = "auto" | "quick" | "none";

/**
 * Provider factory. `auto` prefers Cloudflare Quick Tunnel and degrades to
 * loopback-only rather than failing the whole session.
 */
export async function createTunnelProvider(
  mode: TunnelMode,
  logger: Logger,
  binaryPath?: string
): Promise<TunnelProvider> {
  if (mode === "none") return new NoTunnel();
  if (mode === "quick") return new CloudflaredQuickTunnel(logger, binaryPath);
  const quick = new CloudflaredQuickTunnel(logger, binaryPath);
  const report = await quick.doctor();
  if (report.binaryFound) return quick;
  logger.warn("cloudflared not found; falling back to loopback-only transport.");
  return new NoTunnel();
}
