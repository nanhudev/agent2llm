# Brain adapter: Claude (web)

- **Id:** `claude-web`
- **Role:** `brain`
- **Status:** implemented; **real E2E unverified on this machine**

## What it does

Uses the official Claude web interface as the reasoning Brain, preferring the
official remote-MCP connector path over any automation.

Flow mirrors `chatgpt-web`: official-UI setup, one-action-at-a-time user prompts
for login / CAPTCHA / 2FA, boot prompt, then A2L control blocks over
`BrowserTransport`.

## Prohibited

- Reverse-engineered Claude API.
- Session-token hijacking.
- Cookie-based API access.

If an official feature is gated by plan tier, the capability manifest records
the restriction. It is never faked.

## Capabilities

| Capability | Value |
| --- | --- |
| `plan.generate` | supported |
| `review.perform` | supported |
| `conversation.send` / `receive` | supported |
| `workspace.read` | supported via MCP (connector-dependent) |
| `structuredOutput` | partial — text `[A2L]` block |
| `workspace.write` / `shell.execute` / `git.modify` | **never** |

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Real E2E | **unverified** — requires Claude login; some features are plan-gated |
