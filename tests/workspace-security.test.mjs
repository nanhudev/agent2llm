/**
 * Workspace isolation tests — the security property inherited from C2C and
 * extended here: `..`, absolute paths, symlinks, junctions, case tricks,
 * nonexistent ancestors and sensitive files must all be refused.
 */
import fs from "node:fs";
import path from "node:path";
import { Workspace, WorkspaceError, IgnoreRules } from "@agent2llm/workspace";
import { test, assert, assertEqual, assertThrows, assertRejects } from "@agent2llm/testing";
import { createFixtureWorkspace, createEscapeTarget } from "@agent2llm/fixtures";
import { report } from "./_report.mjs";

test("workspace", "reads a normal file inside the root", async () => {
  const fixture = createFixtureWorkspace();
  try {
    const workspace = new Workspace(fixture.root);
    const result = await workspace.readFile("src/index.ts");
    assert(result.content.includes("answer = 42"), "content must be readable");
    assertEqual(result.path, "src/index.ts", "path is workspace-relative");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "rejects ../ traversal", () => {
  const fixture = createFixtureWorkspace();
  const outside = createEscapeTarget();
  try {
    const workspace = new Workspace(fixture.root);
    assertThrows(() => workspace.resolve("../outside.txt"), ".. must be rejected");
    assertThrows(() => workspace.resolve("src/../../secret.txt"), "nested .. must be rejected");
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("workspace", "rejects absolute paths outside the root", () => {
  const fixture = createFixtureWorkspace();
  const outside = createEscapeTarget();
  try {
    const workspace = new Workspace(fixture.root);
    assertThrows(() => workspace.resolve(outside.file), "absolute escape must be rejected");
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("workspace", "rejects symlink escapes", async () => {
  const fixture = createFixtureWorkspace();
  const outside = createEscapeTarget();
  try {
    const link = path.join(fixture.root, "link.txt");
    try {
      fs.symlinkSync(outside.file, link, "file");
    } catch {
      // Symlinks need privileges on some Windows setups; skip gracefully.
      return;
    }
    const workspace = new Workspace(fixture.root);
    await assertRejects(() => workspace.readFile("link.txt"), undefined, "symlink escape must be rejected");
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("workspace", "rejects a symlinked directory escape", async () => {
  const fixture = createFixtureWorkspace();
  const outside = createEscapeTarget();
  try {
    const link = path.join(fixture.root, "outside-dir");
    try {
      fs.symlinkSync(outside.root, link, "dir");
    } catch {
      return;
    }
    const workspace = new Workspace(fixture.root);
    await assertRejects(
      () => workspace.readFile("outside-dir/secret.txt"),
      undefined,
      "dir symlink escape must be rejected"
    );
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("workspace", "rejects NUL bytes and empty paths", () => {
  const fixture = createFixtureWorkspace();
  try {
    const workspace = new Workspace(fixture.root);
    assertThrows(() => workspace.resolve("src\0/index.ts"), "NUL byte must be rejected");
    assert(workspace.resolve("").rel === "." || workspace.resolve("").rel === "", "empty path resolves to root");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "refuses .env and other sensitive files", () => {
  const fixture = createFixtureWorkspace();
  try {
    const workspace = new Workspace(fixture.root);
    assertThrows(() => workspace.resolve(".env"), ".env must be blocked");
    assertThrows(() => workspace.resolve(".env.local"), ".env.local must be blocked");
    assertThrows(() => workspace.resolve("keys/id_rsa"), "private keys must be blocked");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "allows .env.example", () => {
  const fixture = createFixtureWorkspace();
  try {
    const workspace = new Workspace(fixture.root);
    const resolved = workspace.resolve(".env.example");
    assertEqual(resolved.rel, ".env.example", "example env files are documentation");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "sensitive files are readable only with an explicit override", () => {
  const fixture = createFixtureWorkspace();
  try {
    const workspace = new Workspace(fixture.root);
    const resolved = workspace.resolve(".env", { allowSensitive: true });
    assertEqual(resolved.rel, ".env", "explicit override unlocks the path");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "refuses a missing root and a file root", () => {
  const fixture = createFixtureWorkspace();
  try {
    assertThrows(() => new Workspace(path.join(fixture.root, "nope")), "missing root must throw");
    assertThrows(() => new Workspace(path.join(fixture.root, "README.md")), "file root must throw");
    try {
      new Workspace(path.join(fixture.root, "nope"));
    } catch (error) {
      assert(error instanceof WorkspaceError, "errors must be typed");
      assertEqual(error.code, "FILE_NOT_FOUND");
    }
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "ignore rules hide noise and honour .agent2llmignore", () => {
  const fixture = createFixtureWorkspace();
  try {
    fs.writeFileSync(path.join(fixture.root, ".agent2llmignore"), "src/util.ts\n", "utf8");
    const rules = new IgnoreRules(fixture.root);
    assert(rules.isNoise("node_modules/dep/index.js"), "node_modules is always hidden");
    assert(rules.isSensitive("src/util.ts"), ".agent2llmignore paths are treated as off-limits");
    assert(!rules.isSensitive("src/index.ts"), "non-ignored files stay visible");
    assert(!rules.isHidden("src/index.ts"), "normal files are not hidden");
  } finally {
    fixture.cleanup();
  }
});

test("workspace", "ignore rules also read .c2cignore for migrating users", () => {
  const fixture = createFixtureWorkspace();
  try {
    fs.writeFileSync(path.join(fixture.root, ".c2cignore"), "secret.txt\n", "utf8");
    const rules = new IgnoreRules(fixture.root);
    assert(rules.isSensitive("secret.txt"), ".c2cignore must keep working");
  } finally {
    fixture.cleanup();
  }
});


await report();
