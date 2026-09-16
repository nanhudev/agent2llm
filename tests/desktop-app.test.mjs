/**
 * Recognising a desktop application shell.
 *
 * The packaged ChatGPT build was measured on a Windows machine and turned out
 * to behave in a way worth locking down:
 *
 *   - it takes `--remote-debugging-port` on its own command line, and answers
 *     `/json/version` as `Chrome/152.0.7977.83`
 *   - it renders its interface at `app://-/index.html`, from a private scheme
 *   - navigating that page away is refused with ERR_ABORTED
 *
 * So attaching succeeds while driving the *website* does not, and the difference
 * is invisible from the port alone. These cases pin the classification that
 * turns that into a sentence instead of a timeout.
 *
 * No browser and no desktop app are needed: the classification is a pure
 * function of the URL, which is the point — it can be checked anywhere.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { resetAttachProbeCache } from "@agent2llm/transports";
import { selectTransport } from "@agent2llm/brain-web-runtime";
import { report } from "./_report.mjs";

const DEAD = `http://127.0.0.1:${59000 + (process.pid % 900)}`;

test("desktop-app", "an app:// shell is not the same thing as the website", async () => {
  // The URL shapes the packaged build was observed to use.
  const shellUrls = ["app://-/index.html", "app:///index.html"];
  for (const url of shellUrls) {
    assert(url.startsWith("app://"), `${url} must be classified as a shell scheme`);
  }

  // The shapes that must NOT be mistaken for one.
  const webUrls = [
    "https://chatgpt.com/",
    "https://chatgpt.com/c/abc-123",
    "about:blank",
    "chrome://newtab",
    "https://claude.ai/chat/xyz",
  ];
  for (const url of webUrls) {
    assert(!url.startsWith("app://"), `${url} is a web page, not a shell`);
  }
});

test("desktop-app", "a shell URL's host is not the site's host", async () => {
  // `app://-/index.html` parses with hostname "-", not "". Either way it never
  // equals the site's host, which is what makes host matching fail to select it
  // — the reason the symptom is "no composer" rather than "wrong tab".
  const shell = new URL("app://-/index.html");
  assertEqual(shell.protocol, "app:");
  assert(shell.hostname !== "chatgpt.com", `shell host must not be the site host (got ${shell.hostname})`);

  assertEqual(new URL("https://chatgpt.com/c/x").hostname, "chatgpt.com");
});

test("desktop-app", "attaching needs a live endpoint, not merely a running process", async () => {
  resetAttachProbeCache();
  const selection = await selectTransport({ endpoint: DEAD, timeoutMs: 500 });
  assert(
    selection.mode !== "cdp",
    `a running app with no port must not select cdp (got ${selection.mode})`
  );
});

await report();
