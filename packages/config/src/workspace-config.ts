import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseMinimalYaml, type YamlObject } from "./yaml-lite.js";

/**
 * Workspace-level configuration is optional, non-secret and never wins over
 * machine policy. It exists so a repository can say "this project runs
 * ChatGPT x DSH" without every contributor typing flags.
 */
export const workspaceConfigSchema = z.object({
  brain: z.string().min(1).max(64).optional(),
  harness: z.string().min(1).max(64).optional(),
  workflow: z.string().min(1).max(64).optional(),
  maxIterations: z.number().int().min(1).max(50).optional(),
  ignore: z.array(z.string().min(1).max(200)).max(200).optional(),
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;

export const WORKSPACE_CONFIG_FILES = [
  ".agent2llm.yml",
  ".agent2llm.yaml",
  ".agent2llm.json",
] as const;

/** Keys that must never appear in a workspace file (it would leak into git). */
const FORBIDDEN_KEY_PATTERN = /(token|secret|password|passwd|api[-_]?key|cookie|refresh|private[-_]?key|credential)/i;

export class WorkspaceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConfigError";
  }
}

export function findWorkspaceConfigFile(root: string): string | null {
  for (const file of WORKSPACE_CONFIG_FILES) {
    const candidate = path.join(root, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadWorkspaceConfig(root: string): WorkspaceConfig | null {
  const file = findWorkspaceConfigFile(root);
  if (!file) return null;
  let raw: YamlObject;
  try {
    if (file.endsWith(".json")) {
      raw = JSON.parse(fs.readFileSync(file, "utf8")) as YamlObject;
    } else {
      raw = parseMinimalYaml(fs.readFileSync(file, "utf8"));
    }
  } catch (error) {
    throw new WorkspaceConfigError(`Cannot parse ${path.basename(file)}: ${(error as Error).message}`);
  }

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new WorkspaceConfigError(
        `Workspace config key '${key}' looks like a credential. Secrets must never live in the workspace.`
      );
    }
  }

  const parsed = workspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkspaceConfigError(
      `Invalid workspace config: ${parsed.error.issues[0]?.message ?? "unknown error"}`
    );
  }
  return parsed.data;
}

/** Merge order: explicit CLI flags > workspace config > machine config. */
export function resolvePreference<T>(
  cliValue: T | undefined,
  workspaceValue: T | undefined,
  machineValue: T | undefined
): T | undefined {
  return cliValue ?? workspaceValue ?? machineValue;
}
