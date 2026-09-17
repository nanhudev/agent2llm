/**
 * Who decides where the Harness works.
 *
 * The bug this models: WorkBuddy already has `D:\projects\my-game` open, the
 * user asks Agent2LLM to add a feature, and Agent2LLM asks them to pick a
 * folder. That question has already been answered, by the product, a moment
 * earlier. Relay Mode's default is therefore `harness-owned`.
 *
 * The failure mode to avoid is the opposite one: inventing a root. A run that
 * edits the wrong repository looks exactly like a run that worked. So when the
 * Harness reports nothing and Agent2LLM knows nothing, the answer is `null`
 * plus a sentence naming the way out — never the process cwd standing in for a
 * decision.
 */
import path from "node:path";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { resolveContext, contextFromRoot, pairIdentity, createPair } from "@agent2llm/pairs";
import { newId } from "@agent2llm/core";
import { report } from "./_report.mjs";

test("harness-context", "the harness answer wins in relay mode", () => {
  const resolution = resolveContext({
    reported: { root: "D:\\projects\\my-game", displayName: "my-game", confidence: 0.9 },
    fallbackRoot: "D:\\dev\\agent2llm",
    mode: "harness-owned",
  });

  assert(resolution.context, "a reported root is a context");
  assertEqual(resolution.context.source, "harness", "the harness is credited, not Agent2LLM");
  assertEqual(resolution.context.displayName, "my-game", "the harness's own label is kept");
  assertEqual(resolution.context.confidence, 0.9, "a stated confidence is carried through");
  assertEqual(resolution.context.root, path.resolve("D:\\projects\\my-game"), "the root is absolute");
  assert(resolution.note.includes("harness"), "the note says where the answer came from");
});

test("harness-context", "an unavailable context stays unavailable and names the way out", () => {
  const resolution = resolveContext({ reported: null, mode: "harness-owned" });

  assertEqual(resolution.context, null, "no answer means no context, not a default");
  assert(
    /--workspace/.test(resolution.note),
    `the note must say what to do about it, got: ${resolution.note}`
  );
});

test("harness-context", "a reported context with no root is not a context", () => {
  // The dangerous case: an adapter that answers "yes, I have a context" and
  // supplies no path. Resolving "" would silently land on the process cwd.
  const resolution = resolveContext({
    reported: { displayName: "untitled", confidence: 0.5 },
    mode: "harness-owned",
  });
  assertEqual(resolution.context, null, "a context without a root must not resolve to the cwd");
});

test("harness-context", "legacy brain-hands keeps Agent2LLM's workspace record first", () => {
  const resolution = resolveContext({
    reported: { root: "D:\\projects\\my-game" },
    fallbackRoot: "D:\\dev\\agent2llm",
    mode: "a2l-workspace",
  });

  assert(resolution.context, "a2l-workspace mode resolves a context");
  assertEqual(resolution.context.source, "a2l", "the workspace record outranks the harness in legacy mode");
  assertEqual(resolution.context.root, path.resolve("D:\\dev\\agent2llm"), "the legacy root is used");
});

test("harness-context", "a folder the user names wins over everything, in every mode", () => {
  // This expectation was the other way round until an end-to-end run caught it.
  // `--workspace` is not the user answering a question the harness already
  // answered; it is the user overriding the default, and the default was
  // beating it. The symptom was silent and expensive: with Codex's last session
  // in D:\Chat2Blend, `a2l run "..." --workspace D:\my-repo` would have edited
  // D:\Chat2Blend and reported success. Only a flag typed on *this* command
  // reaches this branch, so nothing can be overridden by accident.
  const relay = resolveContext({
    reported: { root: "D:\\projects\\my-game" },
    userRoot: "D:\\projects\\other",
    fallbackRoot: "D:\\dev\\agent2llm",
    mode: "harness-owned",
  });
  assertEqual(relay.context.source, "user", "relay: a named folder outranks the harness");
  assertEqual(relay.context.root, path.resolve("D:\\projects\\other"), "and it is the one that is used");

  const legacy = resolveContext({
    reported: { root: "D:\\projects\\my-game" },
    userRoot: "D:\\projects\\other",
    fallbackRoot: "D:\\dev\\agent2llm",
    mode: "a2l-workspace",
  });
  assertEqual(legacy.context.source, "a2l", "legacy still keeps Agent2LLM's workspace record first");
  assertEqual(legacy.context.root, path.resolve("D:\\dev\\agent2llm"), "which is the record it was built for");
});

test("harness-context", "with nothing named, the harness still answers", () => {
  const resolution = resolveContext({
    reported: { root: "D:\\projects\\my-game" },
    fallbackRoot: "D:\\dev\\agent2llm",
    mode: "harness-owned",
  });
  assertEqual(resolution.context.source, "harness", "the whole point: no question is asked");
});

test("harness-context", "context id is the resolved root, so a pair is per-project", () => {
  const context = contextFromRoot({ root: "D:/projects/my-game", source: "harness" });
  const pair = createPair({
    pairId: newId("a2lp", 4),
    brainAdapterId: "chatgpt-web",
    harnessAdapterId: "codex",
  });
  const withContext = { ...pair, context };

  // Same adapters, different project: two pairs, because the conversation is
  // about a project. Same adapters and same project: one identity.
  const sameProject = pairIdentity({ ...withContext, context: contextFromRoot({ root: "D:/projects/my-game", source: "harness" }) });
  const otherProject = pairIdentity({ ...withContext, context: contextFromRoot({ root: "D:/projects/other", source: "harness" }) });
  const noProject = pairIdentity(withContext);

  assertEqual(pairIdentity(withContext), sameProject, "the same root is the same pair identity");
  assert(sameProject !== otherProject, "a different context is a different pair identity");
  assert(otherProject !== noProject, "contextual and context-free pairs are distinguishable");
});

await report();
