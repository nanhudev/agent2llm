import type { CapabilityKey, CapabilityManifest, CapabilityRequirement } from "@agent2llm/protocol";
import { capabilitySupport, missingCapabilities } from "@agent2llm/protocol";

/**
 * Compatibility engine.
 *
 * There is no `brain x harness` whitelist anywhere in Agent2LLM. A workflow
 * declares the capabilities it needs; the engine checks both adapters and
 * explains precisely which capability is missing.
 */
export type CheckSeverity = "pass" | "warn" | "fail";

export interface CompatibilityIssue {
  severity: Exclude<CheckSeverity, "pass">;
  target: "brain" | "harness" | "combination";
  code: string;
  message: string;
  missing?: CapabilityKey[];
}

export interface CompatibilityReport {
  ok: boolean;
  severity: CheckSeverity;
  issues: CompatibilityIssue[];
  brainId: string;
  harnessId: string;
  workflowId: string;
}

export interface CompatibilityInput {
  brainId: string;
  brain: CapabilityManifest;
  harnessId: string;
  harness: CapabilityManifest;
  workflowId: string;
  requirement: CapabilityRequirement;
  /**
   * Treat "not logged in yet" as a warning instead of a failure.
   *
   * Used by `--dry-run`, whose job is to answer "is this combination
   * *capable*?" Authentication is a setup step the run itself will walk the
   * user through, not a capability gap.
   */
  ignoreAuth?: boolean;
}

export function checkCompatibility(input: CompatibilityInput): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];

  const missingBrain = missingCapabilities(input.brain, input.requirement.brain);
  if (missingBrain.length > 0) {
    issues.push({
      severity: "fail",
      target: "brain",
      code: "BRAIN_MISSING_CAPABILITY",
      message: `Brain adapter '${input.brainId}' lacks: ${missingBrain.join(", ")}`,
      missing: missingBrain,
    });
  }

  const missingHarness = missingCapabilities(input.harness, input.requirement.harness);
  if (missingHarness.length > 0) {
    issues.push({
      severity: "fail",
      target: "harness",
      code: "HARNESS_MISSING_CAPABILITY",
      message: `Harness adapter '${input.harnessId}' lacks: ${missingHarness.join(", ")}`,
      missing: missingHarness,
    });
  }

  // The Brain must be able to see the workspace through the data plane,
  // otherwise "independent review" is theatre.
  if (capabilitySupport(input.brain, "workspace.read") === "no") {
    issues.push({
      severity: "fail",
      target: "brain",
      code: "BRAIN_CANNOT_INSPECT",
      message: `Brain adapter '${input.brainId}' cannot read the workspace; independent review is impossible.`,
    });
  }

  if (capabilitySupport(input.brain, "structuredOutput") === "no") {
    issues.push({
      severity: "warn",
      target: "brain",
      code: "BRAIN_UNSTRUCTURED",
      message: `Brain adapter '${input.brainId}' does not declare structuredOutput; control messages will be parsed from text.`,
    });
  }

  if (input.brain.auth.required && !input.brain.auth.authenticated) {
    issues.push({
      severity: input.ignoreAuth ? "warn" : "fail",
      target: "brain",
      code: "BRAIN_NOT_AUTHENTICATED",
      message: `Brain adapter '${input.brainId}' requires authentication (${input.brain.auth.method ?? "unknown"}).`,
    });
  }

  if (input.harness.auth.required && !input.harness.auth.authenticated) {
    issues.push({
      severity: "warn",
      target: "harness",
      code: "HARNESS_NOT_AUTHENTICATED",
      message: `Harness adapter '${input.harnessId}' requires authentication (${input.harness.auth.method ?? "unknown"}).`,
    });
  }

  if (input.brain.experimental || input.harness.experimental) {
    issues.push({
      severity: "warn",
      target: "combination",
      code: "EXPERIMENTAL_ADAPTER",
      message: "This combination uses an experimental adapter; behaviour may change.",
    });
  }

  const severity: CheckSeverity = issues.some((issue) => issue.severity === "fail")
    ? "fail"
    : issues.length > 0
      ? "warn"
      : "pass";

  return {
    ok: severity !== "fail",
    severity,
    issues,
    brainId: input.brainId,
    harnessId: input.harnessId,
    workflowId: input.workflowId,
  };
}

export function explainReport(report: CompatibilityReport): string {
  if (report.issues.length === 0) {
    return `${report.brainId} x ${report.harnessId} can run '${report.workflowId}'.`;
  }
  const headline =
    report.severity === "fail"
      ? `Cannot run '${report.workflowId}' with ${report.brainId} x ${report.harnessId}:`
      : `${report.brainId} x ${report.harnessId} can run '${report.workflowId}' with warnings:`;
  return [headline, ...report.issues.map((issue) => `  - ${issue.message}`)].join("\n");
}
