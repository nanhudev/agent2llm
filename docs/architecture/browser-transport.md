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
skips the port sweep. `requireAttach` turns a missing endpoint into an error
instead of a silent fall-through to a launch.

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
and whether a port answered — and never claims that a given build exposes a
DevTools port. Only starting it settles that.

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

## Screenshots and privacy

Debug screenshots are **not** saved by default. When enabled explicitly, they are
written to the private state directory with restrictive permissions, are never
logged, and are never uploaded. Redaction still applies to any captured text.
