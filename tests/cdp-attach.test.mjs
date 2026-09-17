/**
 * CDP attach contract.
 *
 * Attaching is what lets a Web Brain drive a window the user already has
 * open — a desktop application, or their own browser — instead of a browser
 * we launch with a cold and obviously-automated profile. Two properties are
 * worth pinning down, because both are easy to get wrong and expensive to
 * discover in production:
 *
 *   1. an attached window can be driven through the whole transport contract
 *   2. detaching does not take the user's window down with it
 *
 * The fixture browser runs with `--headless=new` deliberately. This test is
 * about the protocol and the contract, not about how a visible window
 * renders, and it has to run on machines with no display. The response to
 * "what does a visible desktop window do differently" is a manual check, not
 * something a test can honestly claim.
 *
 * Skipped rather than failed when the machine has no Chromium to attach to.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test, assert, assertEqual } from "@agent2llm/testing";
import {
  CdpBrowserTransport,
  findAttachEndpoint,
  probeAttachEndpoint,
  resetAttachProbeCache,
} from "@agent2llm/transports";
import { report } from "./_report.mjs";

// A high, derived port so parallel runs on one machine do not collide.
const PORT = 9400 + (process.pid % 400);
const ENDPOINT = `http://127.0.0.1:${PORT}`;

/**
 * A page that behaves like a chat box: type into the composer, press Enter,
 * and an assistant message appears. There is no network involved, so a
 * failure here is always about the transport.
 *
 * The composer carries a min-height because Playwright clicks an element's
 * centre, and an empty contenteditable div is zero pixels tall.
 */
const FIXTURE_HTML = `<!doctype html>
<html><body style="margin:0;font-family:sans-serif">
<div id="composer" contenteditable="true"
     style="min-height:48px;border:1px solid #999;padding:8px"></div>
<div id="log"></div>
<script>
  var composer = document.getElementById('composer');
  composer.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    var node = document.createElement('div');
    node.className = 'assistant';
    node.textContent = 'echo:' + composer.textContent;
    document.getElementById('log').appendChild(node);
    composer.textContent = '';
  });
</script>
</body></html>`;

const FIXTURE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE_HTML)}`;

const SELECTORS = { composer: "#composer", assistantMessage: ".assistant" };

/** Set A2L_CHROMIUM to test against a specific build. */
const CHROMIUM_CANDIDATES = [
  process.env.A2L_CHROMIUM,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChromium() {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/** Number of live DevTools targets, or -1 when the endpoint is gone. */
async function countTargets() {
  try {
    const res = await fetch(`${ENDPOINT}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return -1;
    const list = await res.json();
    return Array.isArray(list) ? list.length : -1;
  } catch {
    return -1;
  }
}

test("cdp-attach", "an endpoint that answers nothing is reported, never guessed", async () => {
  const hit = await probeAttachEndpoint(`http://127.0.0.1:${PORT}`, { timeoutMs: 1500 });
  assertEqual(hit, null, "nothing is listening on the test port, so the probe must return null");
});

test("cdp-attach", "an attached window can be driven, and survives detaching", async () => {
  const chromium = findChromium();
  if (!chromium) {
    console.log("  skip: no Chromium application found (set A2L_CHROMIUM to point at one)");
    return;
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2l-cdp-"));
  const child = spawn(
    chromium,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    await waitForPort(PORT, 25_000);

    // The first case cached "nothing there" for this port. Forget that, so
    // this run looks at the live endpoint instead of a stale negative.
    resetAttachProbeCache();

    const found = await findAttachEndpoint({ ports: [PORT], timeoutMs: 2000 });
    assert(found !== null, "the shared port sweep must find a window that is listening");

    const transport = new CdpBrowserTransport(SELECTORS);
    await transport.launch({ endpoint: ENDPOINT, timeoutMs: 15_000 });
    await transport.open(FIXTURE_URL);

    const state = await transport.state();
    assertEqual(state.loggedIn, true, "the composer must be found in the attached window");

    await transport.type("hello");
    await transport.submit();
    const reply = await transport.waitForReply({ timeoutMs: 15_000 });
    assertEqual(reply, "echo:hello", "a message typed into the attached window must round-trip");

    const before = await countTargets();
    assert(before > 0, "the fixture window should expose at least one target");

    await transport.close();

    const after = await countTargets();
    assert(
      after > 0,
      `detaching closed the window: ${before} target(s) before, the endpoint is gone after. ` +
        "A window the user owns must outlive our session with it."
    );
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 800));
    // Cleanup must not decide the verdict. On Windows a just-killed browser
    // still holds handles inside its profile directory for a moment, so
    // `rmSync` throws EPERM — a teardown artifact that would otherwise fail a
    // test whose assertions have already passed. Retry briefly, then let the
    // OS reclaim it: a temp directory is not worth a red suite.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
});

await report();
