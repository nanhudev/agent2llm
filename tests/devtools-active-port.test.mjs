/**
 * Profile files that name their own port.
 *
 * A package built on WebView2 — which is what the desktop builds are — is not
 * reachable by guessing 9222, because the engine may bind an arbitrary port and
 * write it to `DevToolsActivePort`. Discovery has to survive three shapes of
 * reality: the file at the depth an unpackaged app uses, the file at the depth
 * a Microsoft Store package uses, and a file left behind by a process that has
 * since exited.
 *
 * The third one is why this is worth testing rather than assuming: a stale file
 * must degrade to "nothing there", never to a wrong endpoint that a later
 * attempt would blame on the browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual } from "@agent2llm/testing";
import {
  DEVTOOLS_ACTIVE_PORT_FILE,
  devToolsActivePortPaths,
  discoverAttachEndpoints,
  existingDevToolsActivePortFiles,
  findAttachEndpoint,
  readDevToolsActivePort,
  resetAttachProbeCache,
} from "@agent2llm/transports";
import { report } from "./_report.mjs";

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-profile-"));
const PORT = 59000 + (process.pid % 900);

/** Chromium writes the port on line one and the browser path on line two. */
function writeProfile(file, port) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${port}\n/devtools/browser/0f1e2d3c\n`, "utf8");
}

test("devtools-active-port", "the port is read from the first line of the file", () => {
  const file = path.join(FIXTURE_ROOT, "plain", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE);
  writeProfile(file, PORT);

  const found = readDevToolsActivePort(file);
  assert(found !== null, "a well-formed profile file must yield an endpoint");
  assertEqual(found.endpoint, `http://127.0.0.1:${PORT}`);
});

test("devtools-active-port", "a missing or malformed file yields nothing instead of a guess", () => {
  assertEqual(readDevToolsActivePort(path.join(FIXTURE_ROOT, "nope", "DevToolsActivePort")), null);

  const broken = path.join(FIXTURE_ROOT, "broken", DEVTOOLS_ACTIVE_PORT_FILE);
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, "not-a-port\n", "utf8");
  assertEqual(readDevToolsActivePort(broken), null);

  const empty = path.join(FIXTURE_ROOT, "empty", DEVTOOLS_ACTIVE_PORT_FILE);
  fs.mkdirSync(path.dirname(empty), { recursive: true });
  fs.writeFileSync(empty, "", "utf8");
  assertEqual(readDevToolsActivePort(empty), null);
});

test("devtools-active-port", "both the unpackaged and the Store package layouts are found", () => {
  const unpackaged = path.join(
    FIXTURE_ROOT,
    "ChatGPT",
    "EBWebView",
    DEVTOOLS_ACTIVE_PORT_FILE
  );
  const packaged = path.join(
    FIXTURE_ROOT,
    "Packages",
    "OpenAI.ChatGPT-Desktop_abc123",
    "LocalCache",
    "Local",
    "EBWebView",
    DEVTOOLS_ACTIVE_PORT_FILE
  );
  writeProfile(unpackaged, PORT + 1);
  writeProfile(packaged, PORT + 2);

  const files = existingDevToolsActivePortFiles({ root: FIXTURE_ROOT });
  assert(files.includes(unpackaged), `unpackaged layout missing from ${files.join(", ")}`);
  assert(files.includes(packaged), `Store layout missing from ${files.join(", ")}`);

  const endpoints = discoverAttachEndpoints({ root: FIXTURE_ROOT });
  assert(endpoints.includes(`http://127.0.0.1:${PORT + 1}`), "unpackaged port must be offered");
  assert(endpoints.includes(`http://127.0.0.1:${PORT + 2}`), "Store port must be offered");
});

test("devtools-active-port", "unrelated profile directories are ignored", () => {
  const unrelated = path.join(
    FIXTURE_ROOT,
    "SomeOtherApp",
    "EBWebView",
    DEVTOOLS_ACTIVE_PORT_FILE
  );
  writeProfile(unrelated, PORT + 3);

  const files = existingDevToolsActivePortFiles({ root: FIXTURE_ROOT });
  assert(!files.includes(unrelated), "a profile that is not ours must not be offered");
});

test("devtools-active-port", "candidate paths are listed even before a file exists", () => {
  const candidates = devToolsActivePortPaths({
    root: path.join(FIXTURE_ROOT, "empty-root"),
    match: /chatgpt/i,
  });
  assert(candidates.length === 0, "an empty root has nothing to enumerate");

  const withApp = devToolsActivePortPaths({ root: FIXTURE_ROOT, match: /chatgpt/i });
  assert(withApp.includes(path.join(FIXTURE_ROOT, "ChatGPT", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE)),
    `the unpackaged path must be a candidate even when absent: ${withApp.join(", ")}`);
});

test("devtools-active-port", "a stale profile file is not mistaken for a live window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-stale-"));
  writeProfile(path.join(root, "ChatGPT", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE), PORT + 4);

  resetAttachProbeCache();
  const attach = await findAttachEndpoint({ root, ports: [], timeoutMs: 500 });
  assertEqual(attach, null, "nothing is listening, so nothing may be reported as attachable");
});

await report();
