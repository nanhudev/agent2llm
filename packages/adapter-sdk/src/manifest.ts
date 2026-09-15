import { z } from "zod";
import { CAPABILITY_KEYS } from "@agent2llm/protocol";
import { adapterIncompatible } from "@agent2llm/core";
import type { AdapterRole, AnyAdapter, BrainAdapter, HarnessAdapter } from "./types.js";

/**
 * External adapter packages (`@agent2llm/harness-foo`) describe themselves
 * with this manifest. The core validates `apiVersion` before loading so an
 * incompatible plugin fails with a clear message instead of crashing later.
 */
export const ADAPTER_API_VERSION = "1";

export const adapterManifestSchema = z.object({
  apiVersion: z.string().min(1).max(10),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  version: z.string().min(1).max(30),
  role: z.enum(["brain", "harness"]),
  entrypoint: z.string().min(1).max(200),
  capabilities: z.array(z.enum(CAPABILITY_KEYS)).default([]),
  platforms: z.array(z.enum(["win32", "darwin", "linux"])).default(["win32", "darwin", "linux"]),
  experimental: z.boolean().default(false),
});

export type AdapterManifest = z.infer<typeof adapterManifestSchema>;

export function assertApiVersion(manifest: Pick<AdapterManifest, "apiVersion" | "id">): void {
  if (manifest.apiVersion !== ADAPTER_API_VERSION) {
    throw adapterIncompatible(
      `Adapter '${manifest.id}' targets adapter API v${manifest.apiVersion}, this Agent2LLM build speaks v${ADAPTER_API_VERSION}.`,
      { details: { adapterId: manifest.id, apiVersion: manifest.apiVersion } }
    );
  }
}

export function parseAdapterManifest(value: unknown): AdapterManifest {
  const parsed = adapterManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw adapterIncompatible(
      `Invalid adapter manifest: ${parsed.error.issues[0]?.message ?? "unknown error"}`
    );
  }
  assertApiVersion(parsed.data);
  return parsed.data;
}

export interface AdapterPackage {
  manifest: AdapterManifest;
  create(): AnyAdapter;
}

/** Type-narrowing helpers used by adapter authors. */
export function defineBrainAdapter(adapter: BrainAdapter): BrainAdapter {
  return adapter;
}

export function defineHarnessAdapter(adapter: HarnessAdapter): HarnessAdapter {
  return adapter;
}

export interface AdapterSummary {
  id: string;
  name: string;
  role: AdapterRole;
  experimental: boolean;
}

/** Non-throwing summary used by `agent2llm adapters --json`. */
export function describeAdapter(adapter: AnyAdapter): AdapterSummary {
  const meta = adapter.metadata();
  return {
    id: meta.id,
    name: meta.name,
    role: meta.role,
    experimental: meta.experimental ?? false,
  };
}
