/**
 * Which workflow a run request picks.
 *
 * This is the compatibility boundary the 0.3 upgrade had to draw, so it is
 * tested branch by branch rather than trusted to the CLI's `switch`:
 *
 *   - `--brain X --harness Y` meant brain-hands before Relay existed and must
 *     still mean it. A silent switch here would move a user's runs onto a
 *     different workflow with a different output contract.
 *   - The goal as a bare argument is new, and was *ignored* before, which is
 *     what makes it free to carry the new meaning.
 *   - `--pair` plus the pair's own two halves is refused rather than resolved.
 *     "One of these won and we did not tell you" is the failure mode.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { decideRunMode } from "@agent2llm/pairs";
import { report } from "./_report.mjs";

test("run-routing", "a bare goal argument is Relay Mode", () => {
  const decision = decideRunMode({ positionalGoal: "fix the login bug" });
  assertEqual(decision.mode, "relay", "`a2l run \"goal\"` is the Relay entry point");
  assertEqual(decision.goal, "fix the login bug", "the positional goal reaches the run");
});

test("run-routing", "naming both adapters is brain-hands, exactly as before", () => {
  const decision = decideRunMode({ brain: "chatgpt-web", harness: "codex", goal: "add dark mode" });
  assertEqual(decision.mode, "legacy", "the original invocation keeps its meaning");
  assertEqual(decision.goal, "add dark mode", "the goal still passes through");
});

test("run-routing", "adapters plus a positional goal stay in brain-hands", () => {
  // The positional form is new, but it must not *hijack* a request that named
  // its adapters: those two flags are a stronger statement than a stray word.
  const decision = decideRunMode({ brain: "chatgpt-web", harness: "codex", positionalGoal: "do the thing" });
  assertEqual(decision.mode, "legacy", "an explicit adapter pair outranks the bare argument");
  assertEqual(decision.goal, "do the thing", "and the bare argument is not thrown away");
});

test("run-routing", "a session resume stays in brain-hands even with a goal", () => {
  const decision = decideRunMode({ session: "a2ls_abc12345", positionalGoal: "keep going" });
  assertEqual(decision.mode, "legacy", "resuming a brain-hands session is not a Relay run");
});

test("run-routing", "--pair selects Relay with no adapters needed", () => {
  const decision = decideRunMode({ pairId: "a2lp_abc1234567" });
  assertEqual(decision.mode, "relay", "a stored pair is enough to run");
  assertEqual(decision.goal, undefined, "no goal means the caller must ask for one");
});

test("run-routing", "--relay lets a Pair be found or created from adapters", () => {
  const decision = decideRunMode({ forceRelay: true, brain: "mock-brain", harness: "codex", goal: "slugify" });
  assertEqual(decision.mode, "relay", "--relay overrides the flag that would mean brain-hands");
  assertEqual(decision.goal, "slugify", "the goal survives the override");
});

test("run-routing", "--pair together with the pair's own halves is rejected", () => {
  const decision = decideRunMode({ pairId: "a2lp_abc1234567", brain: "chatgpt-web", harness: "codex" });
  assertEqual(decision.mode, "rejected", "contradictory flags are neither workflow");
  assert(
    typeof decision.error === "string" && decision.error.includes("--pair"),
    "the message has to name the flag that caused it"
  );
  assertEqual(decision.goal, undefined, "a rejected request carries no goal to run");
});

test("run-routing", "--goal alone does not choose Relay", () => {
  // `--goal` predates Relay and is meaningful in both workflows. Making it a
  // Relay trigger would move every configured brain-hands user onto the new
  // workflow the first time they used the flag they already knew.
  const decision = decideRunMode({ goal: "add dark mode" });
  assertEqual(decision.mode, "legacy", "--goal keeps the workflow the user did not name");
  assertEqual(decision.goal, "add dark mode", "and is passed through untouched");
});

test("run-routing", "an empty request changes nothing", () => {
  const decision = decideRunMode({});
  assertEqual(decision.mode, "legacy", "no arguments, no new behaviour");
  assertEqual(decision.goal, undefined, "and no goal to run with");
});

test("run-routing", "an empty goal string is treated as no goal", () => {
  const decision = decideRunMode({ positionalGoal: "" });
  assertEqual(decision.goal, undefined, "an empty goal must not silence the prompt");
});

await report();
