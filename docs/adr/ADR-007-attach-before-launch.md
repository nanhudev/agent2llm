# ADR-007: Attach to a window before launching one

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

Web Brains need a browser. The first implementation launched one with Playwright
and a private profile. That has three costs which only show up in real use:

1. A fresh profile means a fresh login — on every machine, and again whenever the
   profile is cleared.
2. A Chromium that an automation library just launched is precisely the shape
   anti-automation checks look for. `chatgpt.com` answers a headless Playwright
   browser with HTTP 403 on this machine, reproducibly.
3. The window dies with the CLI process, so a user cannot watch the conversation,
   interrupt it, or continue it by hand.

Meanwhile the user often has a suitable window open already: a Chromium desktop
build, or their own browser. It is signed in, it does not look like automation,
and it outlives the process.

## Decision

`BrowserTransport` gains a `cdp` implementation that attaches to a running
Chromium over the DevTools protocol, and transport selection tries it first:

| Order | Mode | Cost |
| --- | --- | --- |
| 1 | `cdp` | none — the user is already signed in |
| 2 | `playwright` | a second login, and a freshly launched automation browser |
| 3 | `manual` | slowest, always available, no dependencies |

Rules that come with it:

- A port counts as attachable only when `/json/version` answers on it and names
  the engine. An open socket is not evidence — an unrelated process can hold a
  port — and guessing converts "no window" into a confusing protocol error later.
- `cdp` never closes the window. `close()` ends our session only. A window the
  user owns must outlive us; `tests/cdp-attach.test.mjs` asserts exactly that.
- Page selection prefers a tab already on the target host, then a blank tab.
  Navigating away from whatever the user was reading is not acceptable.
- The transport is not application-specific. Anything exposing a DevTools port
  works, so there is no per-application adapter to maintain.
- Whether a particular desktop build accepts a debug flag cannot be known from
  outside. Detection reports what it observed and nothing more.
- Discovery reads the port an engine recorded for itself (`DevToolsActivePort`)
  before sweeping conventional ports. A build that lets the OS choose its port —
  because it was started with `--remote-debugging-port=0`, or because its host
  forwards flags through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` instead of its
  own command line — cannot be reached by guessing. A file it wrote can.
- A profile file is not evidence by itself. It outlives its process, so the
  endpoint it names is probed exactly like a guessed one and skipped when nothing
  answers. A live process is identified by the `lockfile` beside the port file;
  without one the file is a leftover and is reported as ignored. Trusting it
  would resurrect the failure the probe rule exists to prevent.
- Attachable is not drivable. A packaged desktop build may serve its own UI from
  an `app://` scheme instead of loading the website, in which case CDP reaches
  it and the website selectors do not. The transport records the scheme and the
  Brain fails with a named error rather than waiting on a selector that cannot
  appear.

## Consequences

- The common case needs no login and no second browser.
- `cdp` and `playwright` share their page-driving logic in
  `packages/transports/src/chromium.ts`, so the two paths cannot drift apart.
- A new failure mode appears: a window on a debug port that we did not start, and
  therefore do not control. Mitigated by probing before attaching, and by never
  closing what we did not open.
- Attaching to a signed-in window is a more sensitive position than launching an
  empty one. The rules do not change — drive the official UI, read no cookies or
  tokens out of the profile, no bypassing login or CAPTCHA — and they are restated
  in `docs/architecture/browser-transport.md`.
- `detect` and `doctor` had to grow a notion of "attachable" that all three callers
  agree on, which is why the port sweep lives in `packages/transports/src/browser.ts`
  and not in each caller.

## Rejected alternatives

- **One adapter per desktop application** (`chatgpt-desktop`, and so on) — a
  separate adapter and maintenance burden per shell, for a difference that does
  not exist at the protocol level. The desktop build and the website render the
  same UI.
- **Keeping a launched browser's profile warm** — still an automation browser,
  still a second login, still dies with the process.
- **UI automation of the desktop window** through accessibility APIs or synthetic
  input — brittle, and it cannot distinguish "the model is thinking" from "the
  application is busy". The DevTools protocol reports both.
