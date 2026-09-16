# ADR-004: Browser transport extraction

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

C2C works partly because Codex itself can drive a browser. Most harnesses
cannot. If browser control lives inside a harness adapter, every new Brain needs
browser code duplicated per harness, and the most security-sensitive component
in the system ends up in the least reviewed place.

## Decision

Browser control is a Core capability: `BrowserTransport`
(`packages/transports/src/browser.ts`), with a Playwright implementation and a
manual (inbox file) implementation. A CDP implementation that attaches to a
window the user already has open was added later — see ADR-007.

Hard rules:

- No reverse proxy of ChatGPT or Claude.
- No private-API interception, no cookie or session-token extraction, no
  internal-endpoint emulation.
- No export or upload of browser profiles.
- Login, CAPTCHA and 2FA are completed by the human through the official UI.
  They surface as `USER_ACTION_REQUIRED`, one action at a time.
- Debug screenshots are not saved by default.

## Consequences

- Any harness can use any web Brain without owning browser code.
- The risky component has one implementation, one review surface, and one set
  of tests (DOM selectors / state parsing / transport are separable, so
  fixtures can drive them).
- Manual transport gives a fallback when automation is blocked.

## Rejected alternatives

- **Per-harness browser code** — duplication plus inconsistent security.
- **Cookie/token reuse** — breaks provider terms and the security model.
- **Terminal scraping of the Brain** — too brittle to be a primary path.
