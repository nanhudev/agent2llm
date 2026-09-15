/**
 * Test fixtures: a throwaway workspace with the sensitive-file shapes that
 * the security tests must refuse, plus sample Brain control blocks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FixtureWorkspace {
  root: string;
  cleanup(): void;
}

const FILES: Record<string, string> = {
  "README.md": "# Fixture workspace\n",
  "src/index.ts": "export const answer = 42;\n",
  "src/util.ts": "export const noop = (): void => undefined;\n",
  ".env": "SECRET=super-secret-value\n",
  ".env.local": "LOCAL_SECRET=another-secret\n",
  ".env.example": "SECRET=replace-me\n",
  "config/credentials.json": '{ "token": "should-never-be-read" }\n',
  // Not a real key. Assembled at runtime so no PEM literal ever lands in the
  // source tree and trips secret scanners, while the deny-list still fires.
  "keys/id_rsa": ["-----BEGIN", "PRIVATE KEY-----", "", "fixture-placeholder", "", "-----END", "PRIVATE KEY-----", ""].join(
    "\n"
  ),
  "node_modules/dep/index.js": "module.exports = {};\n",
};

/**
 * Creates a real directory tree under the OS temp dir and removes it on
 * cleanup. Symlink/junction escapes are created by the security tests
 * themselves, because they need an out-of-root target.
 */
export function createFixtureWorkspace(name = "a2l-fixture"): FixtureWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  for (const [relative, content] of Object.entries(FILES)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return {
    root,
    cleanup(): void {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** An out-of-root directory used as a symlink/junction escape target. */
export function createEscapeTarget(): { root: string; file: string; cleanup(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-outside-"));
  const file = path.join(root, "secret.txt");
  fs.writeFileSync(file, "outside the workspace\n", "utf8");
  return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Control blocks exactly as a web Brain would type them. */
export const SAMPLE_CONTROL_BLOCKS = {
  init: [
    "[A2L]",
    "PROTOCOL: a2l/1",
    "SESSION: a2ls_test",
    "TASK: a2lt_test",
    "ITERATION: 0",
    "STATE: INIT",
    "WORKSPACE: a2lw_test",
    "FROM: core/core",
    "TIME: 2026-01-01T00:00:00.000Z",
    "",
    "GOAL:",
    "Add dark mode",
  ].join("\n"),
  plan: [
    "[A2L]",
    "PROTOCOL: a2l/1",
    "SESSION: a2ls_test",
    "TASK: a2lt_test",
    "ITERATION: 0",
    "STATE: PLAN",
    "WORKSPACE: a2lw_test",
    "FROM: brain/chatgpt-web",
    "TIME: 2026-01-01T00:00:01.000Z",
    "",
    "GOAL:",
    "Add dark mode",
    "RATIONALE:",
    "The app hardcodes light colours.",
    "ACTIONS:",
    "- Add a theme provider",
    "- Toggle the class on <html>",
    "TESTS:",
    "npm test",
    "SUCCESS_CRITERIA:",
    "Toggle switches the palette and tests pass.",
  ].join("\n"),
  done: [
    "[A2L]",
    "PROTOCOL: a2l/1",
    "SESSION: a2ls_test",
    "TASK: a2lt_test",
    "ITERATION: 1",
    "STATE: DONE",
    "WORKSPACE: a2lw_test",
    "FROM: brain/chatgpt-web",
    "TIME: 2026-01-01T00:00:05.000Z",
    "",
    "SUMMARY:",
    "Dark mode implemented and verified against the diff.",
  ].join("\n"),
} as const;

/** A chat reply with prose around the control block, which must still parse. */
export const CHAT_REPLY_WITH_PROSE = [
  "I inspected the workspace and here is my plan.",
  "",
  SAMPLE_CONTROL_BLOCKS.plan,
  "",
  "Let me know if you want me to split this further.",
].join("\n");
