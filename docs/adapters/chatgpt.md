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

## Getting it running

The Brain needs a real, signed-in ChatGPT window. There are two ways to get
one, and the difference is who starts the browser.

### Attach to a window you started (recommended)

The window keeps your existing login, so there is no second sign-in, and you
can watch or interrupt the conversation.

```bash
# Edge
msedge --remote-debugging-port=9222
# Chrome / Chromium
chrome --remote-debugging-port=9222
```

Sign in at <https://chatgpt.com> in that window, then:

```bash
agent2llm doctor                 # "Window attach" should be PASS
agent2llm run --brain chatgpt-web --harness workbuddy --goal "..."
```

If your window listens on another port, name it:

```bash
# one run
agent2llm run --brain chatgpt-web --harness workbuddy --endpoint http://127.0.0.1:9333 --goal "..."

# or make discovery always sweep it
export AGENT2LLM_ATTACH_PORTS=9333
```

`AGENT2LLM_ATTACH_PORTS` exists for `--remote-debugging-port=0`, where the
engine picks a free port and no readable profile records it.

### Let Agent2LLM launch a browser

With no window to attach to and Playwright installed, the Brain launches its
own Chromium with a **persistent** profile under
`<state-dir>/browser-profiles/chatgpt-web`. You sign in on the first run; the
sign-in survives later runs. Nothing else is needed.

### Desktop app caveat

The packaged ChatGPT desktop app can be *attached* to but not *driven*: it
serves its own UI from an `app://` scheme, and its `chatgpt.com` webviews are
not exposed as drivable pages. Use the web app in a browser window.

### Authentication

Agent2LLM does not read another product's credentials, so for this adapter the
sign-in state is **unknown** until a run actually opens the page. That shows as
a warning, not a refusal — blocking on it would stop the run before the window
you need to sign in ever opened. If an adapter has genuinely *measured* that it
is not authenticated, `--ignore-auth` overrides it.

## Transport

Reached through `BrowserTransport`, in preference order:

1. `cdp` — attach to a Chromium window that is already open, given
   `--endpoint` / `AGENT2LLM_ATTACH_ENDPOINT` or a window listening on a default
   port. No second login, and the conversation stays visible.
2. `playwright` — launch a browser with a private profile.
3. `manual` — outbox and inbox files, carried by a person.

See [ADR-007](../adr/ADR-007-attach-before-launch.md) and
[Browser transport](../architecture/browser-transport.md).

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
