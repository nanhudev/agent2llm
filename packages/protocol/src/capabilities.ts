import { z } from "zod";

/**
 * Capability model.
 *
 * Capabilities are the ONLY thing the core knows about an adapter. No
 * `if (adapter === "cursor")` exists anywhere: combinations are validated
 * against capability requirements instead of brand whitelists.
 */

export const CAPABILITY_KEYS = [
  "session.create",
  "session.attach",
  "session.resume",
  "session.cancel",
  "workspace.read",
  "workspace.write",
  "shell.execute",
  "git.inspect",
  "git.modify",
  "task.execute",
  "stream.events",
  "conversation.send",
  "conversation.receive",
  "plan.generate",
  "review.perform",
  "mcp.remote",
  "browser.control",
  "structuredOutput",
  "interactiveApprovals",
  "supportsHeadless",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === "string" && (CAPABILITY_KEYS as readonly string[]).includes(value);
}

export const capabilityDescriptorSchema = z.object({
  supported: z.boolean(),
  /** `partial` means the capability exists but is degraded (documented in notes). */
  level: z.enum(["full", "partial"]).default("full"),
  experimental: z.boolean().default(false),
  notes: z.string().max(300).optional(),
});
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;

export const ADAPTER_STATUSES = [
  "implemented",
  "detected",
  "configured",
  "authenticated",
  "verified",
  "experimental",
  "unsupported",
  "unavailable",
] as const;
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];

export const authStateSchema = z.object({
  required: z.boolean(),
  authenticated: z.boolean(),
  /**
   * Whether `authenticated` is an answer or an absence of one.
   *
   * Most adapters cannot see another product's credentials: a Web Brain would
   * need a browser round trip to know whether a human is signed in, and a CLI
   * harness keeps its session in its own credential store. Reporting
   * `authenticated: false` for those is not a measurement, it is a default —
   * and treating that default as "not signed in" made every Web Brain run fail
   * before it opened a window.
   *
   * `checked` absent means "unknown": the compatibility check warns instead of
   * refusing, and the truth arrives when the run actually tries. An adapter
   * that never measures therefore writes nothing at all, rather than writing a
   * measurement it did not take.
   */
  checked: z.boolean().optional(),
  method: z.string().max(80).optional(),
});
export type AuthState = z.infer<typeof authStateSchema>;

export const capabilityManifestSchema = z.object({
  capabilities: z.record(z.string(), capabilityDescriptorSchema),
  transport: z.enum(["browser", "cdp", "subprocess", "stdio", "rpc", "manual", "http", "in-process"]),
  /** Adapter-reported version of the underlying product, if any. */
  version: z.string().max(60).optional(),
  limitations: z.array(z.string().max(300)).max(30).default([]),
  experimental: z.boolean().default(false),
  auth: authStateSchema.default({ required: false, authenticated: false }),
  /** Free-form, machine-readable facts the adapter probed at runtime. */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const CAPABILITY_DEFAULTS: Record<CapabilityKey, CapabilityDescriptor> = {
  "session.create": { supported: false, level: "full", experimental: false },
  "session.attach": { supported: false, level: "full", experimental: false },
  "session.resume": { supported: false, level: "full", experimental: false },
  "session.cancel": { supported: false, level: "full", experimental: false },
  "workspace.read": { supported: false, level: "full", experimental: false },
  "workspace.write": { supported: false, level: "full", experimental: false },
  "shell.execute": { supported: false, level: "full", experimental: false },
  "git.inspect": { supported: false, level: "full", experimental: false },
  "git.modify": { supported: false, level: "full", experimental: false },
  "task.execute": { supported: false, level: "full", experimental: false },
  "stream.events": { supported: false, level: "full", experimental: false },
  "conversation.send": { supported: false, level: "full", experimental: false },
  "conversation.receive": { supported: false, level: "full", experimental: false },
  "plan.generate": { supported: false, level: "full", experimental: false },
  "review.perform": { supported: false, level: "full", experimental: false },
  "mcp.remote": { supported: false, level: "full", experimental: false },
  "browser.control": { supported: false, level: "full", experimental: false },
  structuredOutput: { supported: false, level: "full", experimental: false },
  interactiveApprovals: { supported: false, level: "full", experimental: false },
  supportsHeadless: { supported: false, level: "full", experimental: false },
};

export function emptyManifest(transport: CapabilityManifest["transport"]): CapabilityManifest {
  return {
    capabilities: { ...CAPABILITY_DEFAULTS },
    transport,
    limitations: [],
    experimental: false,
    auth: { required: false, authenticated: false },
    facts: {},
  };
}

export function withCapabilities(
  manifest: CapabilityManifest,
  enabled: readonly CapabilityKey[],
  overrides: Partial<Record<CapabilityKey, Partial<CapabilityDescriptor>>> = {}
): CapabilityManifest {
  const capabilities: Record<string, CapabilityDescriptor> = { ...CAPABILITY_DEFAULTS };
  for (const key of CAPABILITY_KEYS) {
    if (enabled.includes(key)) {
      capabilities[key] = { supported: true, level: "full", experimental: false, ...overrides[key] };
    }
  }
  return { ...manifest, capabilities };
}

export type CapabilitySupport = "yes" | "partial" | "no";

export function capabilitySupport(
  manifest: CapabilityManifest,
  key: CapabilityKey
): CapabilitySupport {
  const entry = manifest.capabilities[key];
  if (!entry || !entry.supported) return "no";
  return entry.level === "partial" ? "partial" : "yes";
}

export function hasCapability(manifest: CapabilityManifest, key: CapabilityKey): boolean {
  return capabilitySupport(manifest, key) !== "no";
}

export function supportsAll(
  manifest: CapabilityManifest,
  keys: readonly CapabilityKey[]
): boolean {
  return keys.every((key) => hasCapability(manifest, key));
}

export function missingCapabilities(
  manifest: CapabilityManifest,
  keys: readonly CapabilityKey[]
): CapabilityKey[] {
  return keys.filter((key) => !hasCapability(manifest, key));
}

/** A workflow declares what it needs; the compatibility engine checks it. */
export interface CapabilityRequirement {
  brain: readonly CapabilityKey[];
  harness: readonly CapabilityKey[];
}
