/**
 * Adapter contract tests.
 *
 * Every adapter — including Cursor and Claude Code, which are not installed
 * here — must pass the same suite. That is what makes "implemented but
 * unverified" a testable, honest status rather than an excuse.
 */
import { runAdapterContract } from "@agent2llm/testing";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { createMockBrain } from "@agent2llm/brain-mock";
import { createMockHarness } from "@agent2llm/harness-mock";
import { createChatGPTWebBrain } from "@agent2llm/brain-chatgpt-web";
import { createClaudeWebBrain } from "@agent2llm/brain-claude-web";
import { createApiBrain } from "@agent2llm/brain-api";
import { createDeepSeekHarness } from "@agent2llm/harness-deepseek-harness";
import { createWorkBuddyHarness } from "@agent2llm/harness-workbuddy";
import { createCodexHarness } from "@agent2llm/harness-codex";
import { createCursorHarness } from "@agent2llm/harness-cursor";
import { createClaudeCodeHarness } from "@agent2llm/harness-claude-code";
import { createOpenCodeHarness } from "@agent2llm/harness-opencode";
import { report } from "./_report.mjs";

const ADAPTERS = [
  ["mock-brain", createMockBrain()],
  ["chatgpt-web", createChatGPTWebBrain()],
  ["claude-web", createClaudeWebBrain()],
  ["api", createApiBrain()],
  ["dsh", createDeepSeekHarness()],
  ["workbuddy", createWorkBuddyHarness()],
  ["codex", createCodexHarness()],
  ["cursor", createCursorHarness()],
  ["claude-code", createClaudeCodeHarness()],
  ["opencode", createOpenCodeHarness()],
];

for (const [id, adapter] of ADAPTERS) {
  test("adapter-contract", `${id} passes the contract suite`, async () => {
    const checks = await runAdapterContract(adapter);
    const failures = checks.filter((check) => !check.ok);
    assert(
      failures.length === 0,
      `${id} failed: ${failures.map((f) => `${f.name} (${f.detail ?? "no detail"})`).join("; ")}`
    );
    assert(checks.length >= 6, `${id} only produced ${checks.length} checks`);
  });
}

test("adapter-contract", "no Brain adapter claims write, shell or git modify", async () => {
  for (const [id, adapter] of ADAPTERS) {
    const manifest = await adapter.capabilities();
    if (adapter.metadata().role !== "brain") continue;
    assertEqual(manifest.capabilities["workspace.write"].supported, false, `${id} must not claim workspace.write`);
    assertEqual(manifest.capabilities["shell.execute"].supported, false, `${id} must not claim shell.execute`);
    assertEqual(manifest.capabilities["git.modify"].supported, false, `${id} must not claim git.modify`);
    void id;
  }
});

test("adapter-contract", "unused adapters still declare limitations honestly", async () => {
  for (const [id, adapter] of ADAPTERS) {
    const manifest = await adapter.capabilities();
    if (adapter.metadata().experimental) {
      assert(manifest.limitations.length > 0, `experimental adapter ${id} must document limitations`);
    }
  }
});

test("adapter-contract", "a mock never claims to be a real product", async () => {
  assertEqual(createMockBrain().metadata().id, "mock-brain");
  assertEqual(createMockHarness().metadata().id, "mock-harness");
  const manifest = await createMockHarness().capabilities();
  assertEqual(manifest.transport, "in-process", "the mock must not pretend to be a subprocess agent");
});


await report();
