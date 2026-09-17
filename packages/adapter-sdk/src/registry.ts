import type { CapabilityManifest } from "@agent2llm/protocol";
import { adapterNotFound } from "@agent2llm/core";
import type {
  AnyAdapter,
  BrainAdapter,
  DetectionResult,
  HarnessAdapter,
} from "./types.js";
import { isBrainAdapter } from "./types.js";

export interface AdapterDescriptor {
  id: string;
  name: string;
  role: "brain" | "harness";
  experimental: boolean;
  drives?: string;
}

export interface AdapterDetection extends AdapterDescriptor {
  detection: DetectionResult;
  capabilities: CapabilityManifest | null;
}

/**
 * The registry is the only place that knows adapter instances.
 * The core never switches on adapter identity — it asks for capabilities.
 */
export class AdapterRegistry {
  private readonly brains = new Map<string, BrainAdapter>();
  private readonly harnesses = new Map<string, HarnessAdapter>();

  register(adapter: AnyAdapter): void {
    if (isBrainAdapter(adapter)) {
      this.brains.set(adapter.metadata().id, adapter);
    } else {
      this.harnesses.set(adapter.metadata().id, adapter as HarnessAdapter);
    }
  }

  registerAll(adapters: readonly AnyAdapter[]): void {
    for (const adapter of adapters) this.register(adapter);
  }

  get(id: string): AnyAdapter | undefined {
    return this.brains.get(id) ?? this.harnesses.get(id);
  }

  getBrain(id: string): BrainAdapter {
    const adapter = this.brains.get(id);
    if (!adapter) throw adapterNotFound(`No brain adapter registered with id '${id}'.`);
    return adapter;
  }

  getHarness(id: string): HarnessAdapter {
    const adapter = this.harnesses.get(id);
    if (!adapter) throw adapterNotFound(`No harness adapter registered with id '${id}'.`);
    return adapter;
  }

  listBrains(): BrainAdapter[] {
    return [...this.brains.values()];
  }

  listHarnesses(): HarnessAdapter[] {
    return [...this.harnesses.values()];
  }

  descriptors(): AdapterDescriptor[] {
    return [...this.brains.values(), ...this.harnesses.values()].map((adapter) => {
      const meta = adapter.metadata();
      return {
        id: meta.id,
        name: meta.name,
        role: meta.role,
        experimental: meta.experimental ?? false,
        ...(meta.drives ? { drives: meta.drives } : {}),
      };
    });
  }

  /**
   * Detect every registered adapter.
   *
   * The default is the *thorough* probe, because the result of this call is
   * almost always printed somewhere a human reads it, and a report is only
   * useful if it separates "not installed" from "not looked at". A quick pass
   * is an optimisation for a caller that can act on the name alone, and it
   * has to ask for it by name.
   */
  async detectAll(quick = false): Promise<AdapterDetection[]> {
    const adapters: AnyAdapter[] = [...this.brains.values(), ...this.harnesses.values()];
    const results: AdapterDetection[] = [];
    for (const adapter of adapters) {
      const meta = adapter.metadata();
      let detection: DetectionResult;
      let capabilities: CapabilityManifest | null = null;
      try {
        detection = await adapter.detect({ quick });
      } catch (error) {
        detection = {
          status: "unavailable",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      try {
        capabilities = await adapter.capabilities();
      } catch {
        capabilities = null;
      }
      results.push({
        id: meta.id,
        name: meta.name,
        role: meta.role,
        experimental: meta.experimental ?? false,
        ...(meta.drives ? { drives: meta.drives } : {}),
        detection,
        capabilities,
      });
    }
    return results;
  }
}
