import { A2LError } from "./errors.js";
import type { A2LRole } from "@agent2llm/protocol";

/**
 * Permission policy.
 *
 * Permissions come from CODE and CONFIG, never from model text. A Brain that
 * asks "please run rm -rf" gains nothing: the policy below is evaluated
 * before any request is dispatched, and Brain-facing surfaces (MCP) do not
 * expose mutation tools at all.
 */
export const PERMISSIONS = [
  "workspace.read",
  "workspace.write",
  "shell.execute",
  "git.inspect",
  "git.modify",
  "task.execute",
  "conversation.send",
  "browser.control",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PolicyRole = Extract<A2LRole, "brain" | "harness" | "core">;

export type PermissionPolicy = Record<PolicyRole, Record<Permission, boolean>>;

function role(entry: Partial<Record<Permission, boolean>>): Record<Permission, boolean> {
  const result = {} as Record<Permission, boolean>;
  for (const permission of PERMISSIONS) result[permission] = entry[permission] ?? false;
  return result;
}

export const DEFAULT_POLICY: PermissionPolicy = {
  brain: role({
    "workspace.read": true,
    "git.inspect": true,
    "conversation.send": true,
    "browser.control": false,
  }),
  harness: role({
    "workspace.read": true,
    "workspace.write": true,
    "shell.execute": true,
    "git.inspect": true,
    "git.modify": true,
    "task.execute": true,
  }),
  core: role({
    "workspace.read": true,
    "git.inspect": true,
    "conversation.send": true,
    "browser.control": true,
  }),
};

/** A Brain must never hold these, no matter what configuration says. */
export const BRAIN_FORBIDDEN_PERMISSIONS: readonly Permission[] = [
  "workspace.write",
  "shell.execute",
  "git.modify",
];

export function createPolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  const merged = {
    brain: { ...DEFAULT_POLICY.brain, ...overrides.brain },
    harness: { ...DEFAULT_POLICY.harness, ...overrides.harness },
    core: { ...DEFAULT_POLICY.core, ...overrides.core },
  } as PermissionPolicy;
  return sanitizePolicy(merged);
}

/** Hard-denies any attempt (config or bug) to escalate the Brain role. */
export function sanitizePolicy(policy: PermissionPolicy): PermissionPolicy {
  for (const permission of BRAIN_FORBIDDEN_PERMISSIONS) {
    if (policy.brain[permission]) {
      policy.brain[permission] = false;
    }
  }
  return policy;
}

export function isAllowed(
  policy: PermissionPolicy,
  actor: PolicyRole,
  permission: Permission
): boolean {
  return policy[actor][permission] === true;
}

export function assertAllowed(
  policy: PermissionPolicy,
  actor: PolicyRole,
  permission: Permission
): void {
  if (!isAllowed(policy, actor, permission)) {
    throw new A2LError(`Role '${actor}' is not permitted to '${permission}'`, {
      code: "WorkspaceViolation",
      details: { actor, permission },
      retryable: false,
    });
  }
}

/** Reduces a harness policy to the subset the user actually approved. */
export function restrictHarness(
  policy: PermissionPolicy,
  denied: readonly Permission[]
): PermissionPolicy {
  const next = { ...policy, harness: { ...policy.harness } };
  for (const permission of denied) next.harness[permission] = false;
  return next;
}
