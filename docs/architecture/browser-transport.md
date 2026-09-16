# Browser transport

Web Brains (ChatGPT, Claude) are reached through `BrowserTransport`, owned by
Core — **not** by any Harness. A Harness is never allowed to own a browser.

```text
BrainAdapter (chatgpt-web)
      │
      ▼
BrowserTransport ──► cdp         attach to a window that is already open
                 ├─ playwright  launch a browser with a private profile
                 └─ manual      hand the messages to a person
```

## Selection order

`selectTransport()` in `packages/brains/web-runtime/src/index.ts` picks the mode
once per session, in this order:

1. **`cdp`** — a window is already open and something answered on a DevTools
   port. No second login, no automation signature, and the conversation stays in
   a window the user can inspect.
2. **`playwright`** — no window to attach to and Playwright is installed. Works
   with no setup, but starts from an empty profile.
3. **`manual`** — neither is available. Requires no browser and no dependency.

A port only counts as attachable when `/json/version` answers on it and names the
engine. An open socket is not evidence — an unrelated process can hold a port —
and treating one as attachable converts "no window" into a confusing protocol
error later.

Probe answers are cached for one second. `detect` asks several adapters about the
same ports concurrently, and without a cache they race: one probe takes the
connection, another exceeds its timeout, and two adapters disagree about the same
window.

`--endpoint` (or `AGENT2LLM_ATTACH_ENDPOINT`) supplies an explicit endpoint and
skips discovery entirely. `requireAttach` turns a missing endpoint into an error
instead of a silent fall-through to a launch.

## Finding a window that never announced its port

Guessing conventional ports works for a browser started with
`--remote-debugging-port=9222`, and fails for everything that binds a port of
its choosing. Chromium writes the port it bound into `DevToolsActivePort` in its
user-data directory, which is the mechanism this project reads:

```
<user-data-dir>/DevToolsActivePort
  line 1: the port
  line 2: the browser WebSocket path
```

Only line one is used. The HTTP endpoint derived from it behaves exactly like one
written by hand, and `connectOverCDP` accepts either form.

This matters most for a build that binds a port of its own choosing — anything
started with `--remote-debugging-port=0`, and any engine whose host appends a
directory the caller did not name. Two shapes are supported because both occur in
the wild:

- A **WebView2 host** has no `--remote-debugging-port` argument on the app's own
  command line. Its engine reads flags from
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` or from
  `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`,
  and the value may legitimately be `--remote-debugging-port=0`.
- A **full-Chromium build** takes the flag on its own command line, and the app
  is free to pass `=0` and let the OS choose.

In both cases the port is only knowable from the profile file. Which shape a given
desktop build has is not guessable from outside — the ChatGPT Windows app turned
out to be the second, against an earlier assumption that it was the first — so
discovery reads the file rather than reasoning about the host.

`devToolsActivePortPaths()` lists candidate files rather than assuming a layout.
Windows moves these around: an unpackaged app writes to
`%LOCALAPPDATA%\<App>\EBWebView\`, while a Microsoft Store package is redirected
under `%LOCALAPPDATA%\Packages\<package>\` at one of several depths depending on
the directory the host requested. One directory listing plus a name filter
survives that; a fixed path list does not. `root` is injectable so the behaviour
is testable against a fixture directory instead of the real profile store.

A profile file outlives the process that wrote it. That is not treated as a
window: the endpoint is probed like any other, nothing answers, and the sweep
continues. The alternative — trusting the file — would report a dead port as
attachable, which is precisely the failure the `/json/version` rule exists to
prevent.

A live process leaves a `lockfile` in the profile directory it holds, next to the
port file. That is the test used to tell a running window from a leftover: a port
file without a `lockfile` beside it is reported as ignored, not probed. Without
it, an unrelated profile sitting at a similar path was picked up as the app —
which is exactly what happened on the development machine, where an Edge profile
under `%LOCALAPPDATA%\ChatGPT\EBWebView\` was left over from an earlier run.

## Attaching is not driving

A packaged desktop build may not be a browser window at all. The ChatGPT app
serves its interface from `app://-/index.html`: it renders its own UI in Chromium
and never loads `chatgpt.com`. It attaches cleanly over CDP and its DOM is
readable, but a selector written against the website does not describe it, and it
refuses navigation (`ERR_ABORTED`).

The transport records the scheme it landed on, and `web-runtime` raises that as a
named error instead of waiting for a composer that will never render. The honest
summary is that the desktop build is attachable and readable but not drivable
with website selectors; a Brain that needs to drive the UI uses the web app in a
browser window.

Discovery runs before the port sweep: a port an engine recorded itself is
evidence, a port we guessed is a hunch.

## Implementations

| Transport | File | Use |
| --- | --- | --- |
| `CdpBrowserTransport` | `packages/transports/src/cdp.ts` | Attach to a running Chromium window over the DevTools protocol |
| `PlaywrightBrowserTransport` | `packages/transports/src/playwright.ts` | Launch a browser with a private profile |
| `ManualBrowserTransport` | `packages/transports/src/manual.ts` | Outbox and inbox files, carried by a person |

Page-driving logic shared by both Chromium transports — finding the composer,
typing, submitting, reading the reply, detecting a challenge — lives in
`packages/transports/src/chromium.ts`. Each subclass supplies only a context, by
launching or by attaching. That is also why both behave identically under test.

Desktop application sensing lives in `packages/transports/src/desktop.ts`. It
reports what it observed — an executable on disk, whether a process is running,
whether a profile file names a port, and whether anything answered on it — and
never claims that a given build exposes a DevTools port. Distinguishing "installed
but not running" from "installed and unable to be attached to" is the difference
between a hint that works and one that wastes an afternoon; only starting the app
settles the rest.

## Ownership of the window

A browser this project launched is ours to close. A window the user already had
open is not.

- `PlaywrightBrowserTransport.close()` shuts the browser down.
- `CdpBrowserTransport.close()` ends the session and leaves the window running.

`tests/cdp-attach.test.mjs` asserts the second property, because getting it wrong
means closing a window the user was working in.

## Hard rules

Allowed:

- Official website UI automation.
- Official login pages.
- Official MCP connector configuration.
- Ordinary DOM interaction.

Forbidden:

- Reverse proxying ChatGPT or Claude.
- Private-API interception.
- Cookie or session-token extraction.
- Internal-endpoint emulation.
- Exporting or uploading browser profiles.

Attaching does not change this. The transport drives the official UI in a window
the user owns; it does not read cookies or tokens out of that window's profile.

Login, CAPTCHA, 2FA and security confirmations are always completed by the human
through the official UI. They surface as `USER_ACTION_REQUIRED`, one action at a
time.

## Separation for testability

Browser logic is split so it can be tested without a live site:

| Concern | Location |
| --- | --- |
| DOM selectors | `packages/brains/chatgpt-web/src/selectors.ts` |
| Page state parsing | selectors + web-runtime |
| Transport mechanics | `packages/transports/src/{chromium,cdp,playwright}.ts` |
| Endpoint and desktop probes | `packages/transports/src/{browser,desktop}.ts` |
| Workflow / boot prompt | `packages/brains/*/src/boot-prompt.ts`, `web-runtime` |

`tests/cdp-attach.test.mjs` runs the whole contract against a real Chromium over
CDP, driving a fixture page so no network is involved. It uses `--headless=new` on
purpose: the test covers the protocol and the contract, not how a visible window
renders. It is skipped, not failed, on a machine with no Chromium to attach to.

`tests/devtools-active-port.test.mjs` covers profile discovery with no browser at
all, against a temporary directory shaped like both the unpackaged and the Store
layout. The case worth keeping is the stale file: it must degrade to "nothing
there", never to a port that a later attempt would blame on the browser.

## Screenshots and privacy

Debug screenshots are **not** saved by default. When enabled explicitly, they are
written to the private state directory with restrictive permissions, are never
logged, and are never uploaded. Redaction still applies to any captured text.
