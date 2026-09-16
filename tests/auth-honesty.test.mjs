/**
 * Authentication honesty in the compatibility check.
 *
 * The bug this locks down: `auth.authenticated` was a plain boolean, and every
 * adapter that could not see another product's credentials wrote `false`. The
 * check then read that as "not signed in" and refused to run — so no Web Brain
 * ever got as far as opening the window a human needs in order to sign in.
 *
 * "We did not look" and "we looked, it is not there" are different claims and
 * must produce different outcomes: the first warns, the second refuses.
 */
import { checkCompatibility } from "@agent2llm/core";
import { emptyManifest } from "@agent2llm/protocol";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const REQUIREMENT = {
  brain: ["plan.generate", "review.perform"],
  harness: ["task.execute"],
};

function brainManifest(auth) {
  return {
    ...emptyManifest("browser"),
    capabilities: {
      ...emptyManifest("browser").capabilities,
      "session.create": { supported: true, level: "full", experimental: false },
      "session.attach": { supported: true, level: "full", experimental: false },
      "conversation.send": { supported: true, level: "full", experimental: false },
      "conversation.receive": { supported: true, level: "full", experimental: false },
      "workspace.read": { supported: true, level: "full", experimental: false },
      "plan.generate": { supported: true, level: "full", experimental: false },
      "review.perform": { supported: true, level: "full", experimental: false },
      structuredOutput: { supported: true, level: "partial", experimental: false },
    },
    auth,
  };
}

function harnessManifest(auth) {
  return {
    ...emptyManifest("subprocess"),
    capabilities: {
      ...emptyManifest("subprocess").capabilities,
      "session.create": { supported: true, level: "full", experimental: false },
      "task.execute": { supported: true, level: "full", experimental: false },
      "stream.events": { supported: true, level: "full", experimental: false },
      "workspace.read": { supported: true, level: "full", experimental: false },
      "workspace.write": { supported: true, level: "full", experimental: false },
    },
    auth,
  };
}

function check(brainAuth, harnessAuth = { required: false, authenticated: true, checked: true }) {
  return checkCompatibility({
    brainId: "web-brain",
    brain: brainManifest(brainAuth),
    harnessId: "cli-harness",
    harness: harnessManifest(harnessAuth),
    workflowId: "brain-hands",
    requirement: REQUIREMENT,
  });
}

test("auth-honesty", "an unmeasured required sign-in warns instead of refusing", () => {
  const report = check({ required: true, authenticated: false });
  assert(report.ok, "an unknown auth state must not block a run");
  assertEqual(report.severity, "warn");

  const issue = report.issues.find((i) => i.code === "BRAIN_NOT_AUTHENTICATED");
  assert(issue !== undefined, "the reason must still be reported");
  assertEqual(issue.severity, "warn");
  assert(
    /cannot read|unverified/i.test(issue.message),
    `the message must say it is unverified, not that it failed: ${issue.message}`
  );
});

test("auth-honesty", "a measured 'not signed in' still refuses", () => {
  const report = check({ required: true, authenticated: false, checked: true });
  assert(!report.ok, "a real measurement of 'not authenticated' must block");

  const issue = report.issues.find((i) => i.code === "BRAIN_NOT_AUTHENTICATED");
  assertEqual(issue.severity, "fail");
});

test("auth-honesty", "a measured 'signed in' passes cleanly", () => {
  const report = check({ required: true, authenticated: true, checked: true });
  const issue = report.issues.find((i) => i.code === "BRAIN_NOT_AUTHENTICATED");
  assertEqual(issue, undefined, "no auth complaint when the adapter measured a session");
});

test("auth-honesty", "an unmeasured harness also warns rather than refusing", () => {
  const report = check(
    { required: false, authenticated: false },
    { required: true, authenticated: false }
  );
  assert(report.ok, "a harness nobody can vouch for must not stop the run");
  const issue = report.issues.find((i) => i.code === "HARNESS_NOT_AUTHENTICATED");
  assert(issue !== undefined, "it must still be reported");
  assertEqual(issue.severity, "warn");
});

test("auth-honesty", "ignoreAuth downgrades even a measured failure", () => {
  const report = checkCompatibility({
    brainId: "web-brain",
    brain: brainManifest({ required: true, authenticated: false, checked: true }),
    harnessId: "cli-harness",
    harness: harnessManifest({ required: false, authenticated: true, checked: true }),
    workflowId: "brain-hands",
    requirement: REQUIREMENT,
    ignoreAuth: true,
  });
  assert(report.ok, "--ignore-auth is an explicit operator override");
  const issue = report.issues.find((i) => i.code === "BRAIN_NOT_AUTHENTICATED");
  assertEqual(issue.severity, "warn");
});

await report();
