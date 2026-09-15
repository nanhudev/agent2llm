# Browser transport

Web Brains (ChatGPT, Claude) are reached through `BrowserTransport`, owned by
Core — **not** by any Harness.

```text
BrainAdapter (chatgpt-web)
      │
      ▼
BrowserTransport ──► playwright  │  manual inbox
```

## Implementations

| Transport | Use | Notes |
| --- | --- | --- |
| `PlaywrightBrowserTransport` | Automated official-UI interaction | Persistent context, selector strategy per Brain |
| `ManualBrowserTransport` | Fallback when automation is blocked | Writes a prompt to an inbox file and waits for a reply file |
| `NoBrowserTransport` | Tests / API brains | Fails loudly rather than pretending |

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

Login, CAPTCHA, 2FA and security confirmations are always completed by the
human through the official UI. They surface as `USER_ACTION_REQUIRED`, one
action at a time.

## Separation for testability

Browser logic is split so it can be tested with fixtures instead of a live site:

| Concern | Location |
| --- | --- |
| DOM selectors | `packages/brains/chatgpt-web/src/selectors.ts` |
| Page state parsing | selectors + web-runtime |
| Transport mechanics | `packages/transports/src/playwright.ts` |
| Workflow / boot prompt | `packages/brains/*/src/boot-prompt.ts`, `web-runtime` |

## Screenshots and privacy

Debug screenshots are **not** saved by default. When enabled explicitly, they
are written to the private state directory with restrictive permissions and are
never logged, never uploaded, and redaction still applies to any captured text.
