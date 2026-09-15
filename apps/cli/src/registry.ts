/**
 * The only place that enumerates built-in adapters.
 *
 * Adding a third-party adapter does not touch this file: use
 * `loadAdapterPackage()` from the SDK and `registry.register()`.
 */
import { AdapterRegistry, loadAdapter, type AnyAdapter } from "@agent2llm/adapter-sdk";
import { loadMachineConfig } from "@agent2llm/config";
import { createMockBrain } from "@agent2llm/brain-mock";
import { createChatGPTWebBrain } from "@agent2llm/brain-chatgpt-web";
import { createClaudeWebBrain } from "@agent2llm/brain-claude-web";
import { createApiBrain } from "@agent2llm/brain-api";
import { createMockHarness } from "@agent2llm/harness-mock";
import { createDeepSeekHarness } from "@agent2llm/harness-deepseek-harness";
import { createWorkBuddyHarness } from "@agent2llm/harness-workbuddy";
import { createCodexHarness } from "@agent2llm/harness-codex";
import { createCursorHarness } from "@agent2llm/harness-cursor";
import { createClaudeCodeHarness } from "@agent2llm/harness-claude-code";
import { createOpenCodeHarness } from "@agent2llm/harness-opencode";

export function createRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.registerAll([
    createMockBrain(),
    createChatGPTWebBrain(),
    createClaudeWebBrain(),
    createApiBrain(),
    createMockHarness(),
    createDeepSeekHarness(),
    createWorkBuddyHarness(),
    createCodexHarness(),
    createCursorHarness(),
    createClaudeCodeHarness(),
    createOpenCodeHarness(),
  ]);
  return registry;
}

/** Loads adapters declared in `~/.agent2llm/config.json`. */
export async function registerExternalAdapters(registry: AdapterRegistry): Promise<string[]> {
  const config = loadMachineConfig();
  const specs = config.adapterPackages;
  const loaded: string[] = [];
  for (const spec of specs) {
    try {
      const { adapter } = await loadAdapter(spec);
      registry.register(adapter as AnyAdapter);
      loaded.push(adapter.metadata().id);
    } catch {
      // Reported by `agent2llm doctor`; startup must not fail on a bad plugin.
    }
  }
  return loaded;
}

export const RECOMMENDED_BRAIN_ORDER = ["chatgpt-web", "claude-web", "api", "mock-brain"] as const;
export const RECOMMENDED_HARNESS_ORDER = [
  "dsh",
  "workbuddy",
  "codex",
  "cursor",
  "claude-code",
  "opencode",
  "mock-harness",
] as const;
