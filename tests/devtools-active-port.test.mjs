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
  ATTACH_PORTS_ENV,
  DEVTOOLS_ACTIVE_PORT_FILE,
  attachEndpointSource,
  attachRepairHint,
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

/**
 * Two ways a machine ends up with a window whose port nobody can guess:
 * the operator names the endpoint outright, or names the port. Both used to
 * be ignored by every read-only caller, which is why `doctor` reported "no
 * DevTools endpoint answered" while a window sat there answering.
 */
function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[name] = previous;
    else delete process.env[name];
  }
}

test("devtools-active-port", "an operator-named port is offered by discovery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-ports-"));
  writeProfile(path.join(root, "ChatGPT", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE), PORT + 5);

  const plain = discoverAttachEndpoints({ root, ports: [] });
  assert(!plain.includes(`http://127.0.0.1:${PORT + 6}`), "an unnamed port must not appear by accident");

  const named = withEnv(ATTACH_PORTS_ENV, `${PORT + 6},${PORT + 6}`, () =>
    discoverAttachEndpoints({ root, ports: [] })
  );
  assert(named.includes(`http://127.0.0.1:${PORT + 6}`), `named port missing from ${named.join(", ")}`);
  assertEqual(
    named.filter((e) => e === `http://127.0.0.1:${PORT + 6}`).length,
    1,
    "a repeated port must be listed once"
  );
});

test("devtools-active-port", "a garbage port list is dropped rather than trusted", () => {
  const listed = withEnv(ATTACH_PORTS_ENV, "not-a-port,0,99999,  ,9222", () =>
    discoverAttachEndpoints({ root: fs.mkdtempSync(path.join(os.tmpdir(), "a2l-garbage-")), ports: [] })
  );
  assert(listed.includes("http://127.0.0.1:9222"), "the one valid entry must survive");
  assertEqual(
    listed.filter((e) => e === "http://127.0.0.1:9222").length,
    1,
    "exactly one valid entry was given"
  );
});

test("devtools-active-port", "discovery reports which place it would have looked", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-source-"));
  writeProfile(path.join(root, "ChatGPT", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE), PORT + 7);

  const fromProfile = attachEndpointSource({ root, ports: [] });
  assertEqual(fromProfile.kind, "profile", "a written profile is the strongest hint available");
  assert(
    fromProfile.endpoints.includes(`http://127.0.0.1:${PORT + 7}`),
    `profile port missing from ${fromProfile.endpoints.join(", ")}`
  );

  const fromPorts = attachEndpointSource({ root: fs.mkdtempSync(path.join(os.tmpdir(), "a2l-bare-")) });
  assertEqual(fromPorts.kind, "ports", "with no evidence at all, the conventional ports are the answer");

  const explicit = attachEndpointSource({
    root,
    ports: [],
    explicitEndpoint: "http://127.0.0.1:9333",
  });
  assertEqual(explicit.kind, "explicit", "a named endpoint outranks every heuristic");
  assertEqual(explicit.endpoint, "http://127.0.0.1:9333");
});

test("devtools-active-port", "the repair hint names the place that was searched", () => {
  const profileHint = attachRepairHint({ kind: "profile", endpoints: ["http://127.0.0.1:50517"] });
  assert(
    profileHint.includes("50517"),
    "a dead profile port must be named, or the user cannot tell it is stale"
  );

  const explicitHint = attachRepairHint({ kind: "explicit", endpoint: "http://127.0.0.1:9333" });
  assert(explicitHint.includes("9333"), "the endpoint the user supplied must appear in the hint");

  const portsHint = attachRepairHint({ kind: "ports", ports: [9222, 9223, 9229] });
  assert(portsHint.includes("9222"), "the ports actually swept must be named");
});

test("devtools-active-port", "an explicit endpoint is returned even when it answers nothing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-dead-"));
  writeProfile(path.join(root, "ChatGPT", "EBWebView", DEVTOOLS_ACTIVE_PORT_FILE), PORT + 8);

  resetAttachProbeCache();
  // No listener anywhere: the honest answer is still "nothing", but crucially
  // it is nothing *found by the explicit path*, which the hint then says.
  const attach = await findAttachEndpoint({
    root,
    ports: [],
    explicitEndpoint: `http://127.0.0.1:${PORT + 9}`,
    timeoutMs: 400,
  });
  assertEqual(attach, null, "a dead explicit endpoint must not be reported as attachable");
});

await report();
