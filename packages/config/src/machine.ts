import { z } from "zod";
import { getStateDir, readJsonIfExists, writeSecureJson } from "./paths.js";

/**
 * Machine-level configuration. Lives outside every workspace and is the
 * only place allowed to store long-lived (non-secret) preferences.
 * Secrets never land here: token material is hashed in the auth store.
 */
export const machineConfigSchema = z.object({
  defaultBrain: z.string().min(1).max(64).optional(),
  defaultHarness: z.string().min(1).max(64).optional(),
  defaultWorkflow: z.string().min(1).max(64).default("brain-hands"),
  maxIterations: z.number().int().min(1).max(50).default(12),
  logLevel: z.enum(["error", "warn", "info", "debug", "trace"]).default("info"),
  autoStartBridge: z.boolean().default(true),
  presets: z.record(z.string(), z.object({
    brain: z.string().min(1).max(64),
    harness: z.string().min(1).max(64),
    workflow: z.string().min(1).max(64).default("brain-hands"),
  })).default({}),
  /**
   * Third-party adapter packages (`@agent2llm/harness-foo`). Loaded at
   * startup; a broken plugin is reported by `agent2llm doctor`, never fatal.
   */
  adapterPackages: z.array(z.string().min(1).max(200)).default([]),
});

export type MachineConfig = z.infer<typeof machineConfigSchema>;

const CONFIG_FILE = "config.json";

export function machineConfigPath(): string {
  return `${getStateDir()}/${CONFIG_FILE}`;
}

export function defaultMachineConfig(): MachineConfig {
  return machineConfigSchema.parse({});
}

export function loadMachineConfig(): MachineConfig {
  const file = machineConfigPath();
  const raw = readJsonIfExists<unknown>(file);
  if (!raw) return defaultMachineConfig();
  const parsed = machineConfigSchema.safeParse(raw);
  if (!parsed.success) return defaultMachineConfig();
  return parsed.data;
}

export function saveMachineConfig(config: MachineConfig): MachineConfig {
  writeSecureJson(machineConfigPath(), machineConfigSchema.parse(config));
  return config;
}

export function patchMachineConfig(patch: Partial<MachineConfig>): MachineConfig {
  return saveMachineConfig({ ...loadMachineConfig(), ...patch });
}
