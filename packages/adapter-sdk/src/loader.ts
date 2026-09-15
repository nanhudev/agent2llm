import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { adapterIncompatible, adapterNotFound } from "@agent2llm/core";
import { parseAdapterManifest, type AdapterManifest, type AdapterPackage } from "./manifest.js";
import type { AnyAdapter } from "./types.js";

/**
 * Third-party adapter loading.
 *
 * `agent2llm` must be extensible without patching this repository: an npm
 * package that exports `{ manifest, create }` can be registered at runtime.
 */
export interface LoadOptions {
  /** Directory used to resolve the specifier (defaults to cwd). */
  cwd?: string;
}

async function resolveEntrypoint(specifier: string, cwd: string): Promise<string> {
  const require = createRequire(path.join(cwd, "package.json"));
  try {
    return require.resolve(specifier);
  } catch {
    try {
      const resolved = import.meta.resolve(specifier);
      return resolved.startsWith("file:") ? resolved : resolved;
    } catch {
      throw adapterNotFound(`Cannot resolve adapter package '${specifier}' from ${cwd}.`);
    }
  }
}

function extractPackage(module: Record<string, unknown>, specifier: string): AdapterPackage {
  const manifestRaw = module.manifest ?? module.adapterManifest;
  if (!manifestRaw) {
    throw adapterIncompatible(`Adapter package '${specifier}' does not export a manifest.`);
  }
  const manifest: AdapterManifest = parseAdapterManifest(manifestRaw);
  const create = module.create ?? module.default;
  if (typeof create !== "function") {
    throw adapterIncompatible(`Adapter package '${specifier}' does not export a create() factory.`);
  }
  return { manifest, create: () => create() as AnyAdapter };
}

export async function loadAdapterPackage(
  specifier: string,
  options: LoadOptions = {}
): Promise<AdapterPackage> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = await resolveEntrypoint(specifier, cwd);
  const url = resolved.startsWith("file:") ? resolved : pathToFileURL(resolved).href;
  const imported = (await import(url)) as Record<string, unknown>;
  return extractPackage(imported, specifier);
}

export async function loadAdapter(
  specifier: string,
  options: LoadOptions = {}
): Promise<{ manifest: AdapterManifest; adapter: AnyAdapter }> {
  const pkg = await loadAdapterPackage(specifier, options);
  const adapter = pkg.create();
  if (adapter.metadata().id !== pkg.manifest.id) {
    throw adapterIncompatible(
      `Adapter package '${specifier}' declares id '${pkg.manifest.id}' but its factory returns '${adapter.metadata().id}'.`
    );
  }
  return { manifest: pkg.manifest, adapter };
}
