/**
 * "Where is the harness working?" — answered from Codex's own files.
 *
 * The harness-owned context is the claim that makes Relay Mode pleasant: a
 * user with a project already open should not be asked which folder to use.
 * The failure that matters is not "we could not tell", it is "we told a
 * confident lie and the run edited the wrong repository" — so every rule in
 * `active-context.ts` is a rule about refusing.
 *
 * Two of them come from measurements on a real machine rather than from
 * theory, and both are tested here:
 *
 *   - Codex Desktop runs each task inside its own scratch tree
 *     (`~/Documents/Codex/<date>/<task>`). Those are the *newest* rollouts on
 *     a Desktop user's disk, and they are not their project.
 *   - Rollouts outlive the folders they mention.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { readLatestCodexContext, codexManagedRoots } from "@agent2llm/harness-codex";
import { createCodexHarness } from "@agent2llm/harness-codex";
import { createWorkBuddyHarness } from "@agent2llm/harness-workbuddy";
import { resolveContext } from "@agent2llm/pairs";
import { report } from "./_report.mjs";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function fakeHome(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `a2l-codex-${name}-`));
  return { codexHome: path.join(dir, ".codex"), home: path.join(dir, "home") };
}

let sequence = 0;

/** Writes a rollout whose first line is a `session_meta`, like the real thing. */
function rollout(place, { day, stamp, cwd, originator = "codex_exec", timestamp = `${day}T00:00:00.000Z` }) {
  const dir = path.join(place.codexHome, "sessions", ...day.split("-"));
  fs.mkdirSync(dir, { recursive: true });
  const id = `0000000${sequence++}-1111-2222-3333-444444444444`;
  const file = path.join(dir, `rollout-${stamp}-${id}.jsonl`);
  const meta = {
    timestamp,
    type: "session_meta",
    // Real rollouts carry the timestamp in both places, a millisecond apart.
    payload: { session_id: id, cwd, originator, cli_version: "0.154.0-alpha.6.2", timestamp },
  };
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n${JSON.stringify({ type: "turn.started" })}\n`);
  return file;
}

test("codex-context", "no sessions directory is reported as such, not as a guess", () => {
  const place = fakeHome("empty");
  const scan = readLatestCodexContext({ ...place, now: NOW });
  assertEqual(scan.root, null, "nothing to report");
  assertEqual(scan.scanned, 0, "and nothing was read");
  assert(scan.note.includes("no recorded sessions"), `the note says why, got: ${scan.note}`);
});

test("codex-context", "the newest session's folder is offered", () => {
  const place = fakeHome("latest");
  const project = path.join(place.home, "projects", "my-game");
  rollout(place, { day: "2026-09-16", stamp: "2026-09-16T10-00-00", cwd: project });
  rollout(place, { day: "2026-09-17", stamp: "2026-09-17T09-00-00", cwd: project, timestamp: "2026-09-17T09:00:00.000Z" });

  const scan = readLatestCodexContext({ ...place, exists: () => true, now: NOW });
  assertEqual(scan.root, path.join(place.home, "projects", "my-game"), "the newest rollout wins");
  assertEqual(scan.originator, "codex_exec", "and Codex's own label travels with it");
  assertEqual(scan.at, "2026-09-17T09:00:00.000Z", "including when it ran");
});

test("codex-context", "a Codex Desktop scratch tree is skipped, not returned", () => {
  const place = fakeHome("desktop");
  const scratch = path.join(place.home, "Documents", "Codex", "2026-09-14", "sao-m");
  const project = path.join(place.home, "projects", "real-one");
  rollout(place, { day: "2026-09-14", stamp: "2026-09-14T10-00-00", cwd: project });
  rollout(place, {
    day: "2026-09-17",
    stamp: "2026-09-17T09-00-00",
    cwd: scratch,
    originator: "codex_work_desktop",
    timestamp: "2026-09-17T09:00:00.000Z",
  });

  const scan = readLatestCodexContext({ ...place, exists: () => true, now: NOW });
  assertEqual(scan.root, project, "the newest *usable* session is used, not the newest session");
  assert(!scan.root.includes("Documents"), "and Codex's own workspace is never the answer");
  assertEqual(scan.scanned, 2, "the desktop rollout was read and rejected");
});

test("codex-context", "when only Codex's own workspaces exist, the answer is nothing plus a reason", () => {
  const place = fakeHome("only-desktop");
  const scratch = path.join(place.codexHome, ".chatgpt-projects", "g-p-abc");
  rollout(place, { day: "2026-09-17", stamp: "2026-09-17T09-00-00", cwd: scratch, originator: "codex_work_desktop" });

  const scan = readLatestCodexContext({ ...place, exists: () => true, now: NOW });
  assertEqual(scan.root, null, "no user project was found, so none is claimed");
  assert(scan.note.includes("Codex's own workspace"), `the note names the reason, got: ${scan.note}`);
});

test("codex-context", "a folder that no longer exists is not a context", () => {
  const place = fakeHome("gone");
  const gone = path.join(place.home, "projects", "deleted");
  rollout(place, { day: "2026-09-17", stamp: "2026-09-17T09-00-00", cwd: gone });

  const scan = readLatestCodexContext({ ...place, exists: () => false, now: NOW });
  assertEqual(scan.root, null, "a rollout outlives the folder it mentions");
  assert(scan.note.includes("no longer there"), `the note says the folder is gone, got: ${scan.note}`);
});

test("codex-context", "a session from months ago is not offered as a default", () => {
  const place = fakeHome("stale");
  const project = path.join(place.home, "projects", "old");
  rollout(place, {
    day: "2026-06-01",
    stamp: "2026-06-01T09-00-00",
    cwd: project,
    timestamp: "2026-06-01T09:00:00.000Z",
  });

  const scan = readLatestCodexContext({ ...place, exists: () => true, now: NOW });
  assertEqual(scan.root, null, "108 days is not a current project");
  assert(scan.note.includes("days ago"), `the note says how stale, got: ${scan.note}`);
});

test("codex-context", "a rollout without a usable header is skipped, not crashed on", () => {
  const place = fakeHome("malformed");
  const project = path.join(place.home, "projects", "good");
  const broken = path.join(place.codexHome, "sessions", "2026", "09", "17");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "rollout-2026-09-17T10-00-00-broken.jsonl"), "{not json\n");
  fs.writeFileSync(
    path.join(broken, "rollout-2026-09-17T11-00-00-notmeta.jsonl"),
    `${JSON.stringify({ type: "turn.started" })}\n`
  );
  rollout(place, { day: "2026-09-16", stamp: "2026-09-16T10-00-00", cwd: project });

  const scan = readLatestCodexContext({ ...place, exists: () => true, now: NOW });
  assertEqual(scan.root, project, "an unreadable rollout is skipped and the search continues");
});

test("codex-context", "the adapter reports the basis, and a note when it has no root", async () => {
  const place = fakeHome("adapter");
  const project = path.join(place.home, "projects", "mine");
  fs.mkdirSync(project, { recursive: true });
  rollout(place, { day: "2026-09-17", stamp: "2026-09-17T09-00-00", cwd: project });

  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = place.codexHome;
  try {
    const reportWithRoot = await createCodexHarness().getActiveContext();
    assertEqual(reportWithRoot.root, project, "the adapter answers with a real folder");
    assertEqual(reportWithRoot.detail.basis, "latest-session", "and says what the answer is based on");
    assertEqual(reportWithRoot.detail.originator, "codex_exec", "and which codex wrote it");
    assert(
      typeof reportWithRoot.confidence === "number" && reportWithRoot.confidence < 1,
      "a rollout is a strong signal, not a declaration of what is open"
    );
    assert(reportWithRoot.note.length > 0, "the user gets a sentence, not a bare path");

    // Remove the folder's evidence: the same adapter must refuse rather than
    // fall back to the path it remembers.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-codex-adapter-empty-"));
    process.env.CODEX_HOME = empty;
    const reportWithout = await createCodexHarness().getActiveContext();
    assertEqual(reportWithout.root, undefined, "no sessions means no root");
    assert(reportWithout.note.includes("no recorded sessions"), "and the reason survives to the caller");
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

test("codex-context", "a note is not a context — the domain layer still refuses it", () => {
  // The adapter's explanation must not be mistaken for an answer by anything
  // downstream. `resolveContext` is the gate, and a rootless report is not a
  // context however well it explains itself.
  const resolution = resolveContext({
    reported: { note: "Codex's newest session ran in Codex's own workspace." },
    mode: "harness-owned",
  });
  assertEqual(resolution.context, null, "a report with no root is no context");
  assert(resolution.note.includes("No context"), "and the caller is told to pass --workspace");
});

test("codex-context", "WorkBuddy says it does not report a context", async () => {
  // Not a stub: the only record WorkBuddy keeps is a slugified directory name,
  // which cannot be turned back into a path without inventing one.
  assertEqual(await createWorkBuddyHarness().getActiveContext(), null, "null means 'not advertised'");
});

test("codex-context", "the managed roots are Codex's own, not the user's projects", () => {
  const roots = codexManagedRoots({ codexHome: "C:\\Users\\u\\.codex", home: "C:\\Users\\u" });
  assert(
    roots.includes(path.join("C:\\Users\\u\\.codex", ".chatgpt-projects")),
    "git projects are Codex-managed"
  );
  assert(roots.includes(path.join("C:\\Users\\u", "Documents", "Codex")), "so are Desktop scratch trees");
});

await report();
