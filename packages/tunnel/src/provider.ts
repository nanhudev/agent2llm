/**
 * Tunnel abstraction — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/tunnel/provider.ts
 * Business logic never talks to a vendor: adding Tailscale/ngrok/custom is a
 * new implementation of this interface, not a change to the bridge.
 */
export interface TunnelStatus {
  running: boolean;
  url: string | null;
  provider: string;
  detail?: string;
}

export interface TunnelDoctorReport {
  provider: string;
  binaryFound: boolean;
  binaryPath: string | null;
  running: boolean;
  url: string | null;
  problems: string[];
}

export interface TunnelProvider {
  readonly name: string;
  start(localPort: number): Promise<string>;
  stop(): Promise<void>;
  restart(localPort: number): Promise<string>;
  status(): TunnelStatus;
  getPublicUrl(): string | null;
  doctor(): Promise<TunnelDoctorReport>;
}
