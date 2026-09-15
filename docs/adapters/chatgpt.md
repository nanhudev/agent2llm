# Brain adapter: ChatGPT (web)

- **Id:** `chatgpt-web`
- **Role:** `brain`
- **Status:** implemented; **real E2E unverified on this machine** (requires a
  ChatGPT login and an official MCP connector configuration)

## What it does

Uses the official ChatGPT web interface as the reasoning Brain. It never touches
a private API, never reads cookies, and never reverse-proxies the product.

Flow:

1. `setup` — open the official site in a `BrowserTransport`; if login,
   CAPTCHA or 2FA appears, raise `USER_ACTION_REQUIRED` for **one** action and
   wait.
2. `createSession` — start a conversation and send the internal boot prompt.
3. Control loop — Core sends `INIT` / `EXECUTED`; the Brain replies with an
   `[A2L]` block embedded in its message, parsed by
   `packages/protocol/src/wire.ts`.
4. `verifyWorkspace` — confirm the Brain can actually reach the read-only MCP
   connector before the run starts.

## Boot prompt

`packages/brains/chatgpt-web/src/boot-prompt.ts` tells the Brain, in effect:

- You are the Brain. You do not execute or mutate the workspace.
- Inspect through the Agent2LLM MCP tools.
- Produce concrete, finite execution plans.
- After execution, inspect the actual changes yourself.
- Never trust an execution claim without reviewing the diff.
- Return valid A2L control messages.

The boot prompt does **not** contain project code. Workspace data is read on
demand through MCP.

## Capabilities

| Capability | Value |
| --- | --- |
| `plan.generate` | supported |
| `review.perform` | supported |
| `conversation.send` / `receive` | supported |
| `workspace.read` | supported, via MCP data plane |
| `structuredOutput` | partial — text `[A2L]` block, not JSON |
| `workspace.write` / `shell.execute` / `git.modify` | **never** |

## Limitations

- Control messages are parsed from model prose; malformed blocks are rejected
  rather than guessed at.
- DOM selectors can change when ChatGPT ships UI updates. Selectors are
  isolated in `src/selectors.ts` so a fix is a one-file change.
- Project / connector handling depends on the official connector feature.

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Local detection | n/a (web product) |
| Real E2E | **unverified** — requires user login |
