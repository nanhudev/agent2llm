# Third-party notices

Agent2LLM is MIT licensed. This file records third-party code and ideas that
Agent2LLM incorporates or builds on, so attribution travels with the source.

## codex-with-chatgpt (C2C)

- **Upstream:** https://github.com/XiaoDuoYa/codex-with-chatgpt
- **License:** MIT
- **Copyright:** Copyright (c) 2026 codex-with-chatgpt contributors
- **Upstream version reviewed:** 0.1.3

### Substantial reuse (MIT notice retained)

Modules whose structure, algorithms or security properties are derived from
C2C carry an in-file header of the form:

```text
ADAPTED FROM codex-with-chatgpt (MIT)
Copyright (c) 2026 codex-with-chatgpt contributors
```

The following areas are derived from C2C and keep that header:

| Agent2LLM module                              | C2C origin                        | Level   |
| --------------------------------------------- | --------------------------------- | ------- |
| `packages/auth/src/oauth.ts`                  | `src/auth/oauth.ts`               | ADAPT   |
| `packages/auth/src/store.ts`                  | `src/auth/store.ts`               | ADAPT   |
| `packages/auth/src/middleware.ts`             | `src/auth/middleware.ts`          | ADAPT   |
| `packages/pairing/src/manager.ts`             | `src/pairing/manager.ts`          | ADAPT   |
| `packages/workspace/src/manager.ts`           | `src/workspace/manager.ts`        | ADAPT   |
| `packages/workspace/src/ignore.ts`            | `src/workspace/ignore.ts`         | ADAPT   |
| `packages/mcp/src/**`                         | `src/mcp/server.ts`, `mcp/http.ts`| ADAPT   |
| `packages/execution/src/records.ts`           | `src/execution/records.ts`        | ADAPT   |
| `packages/bridge/src/**`                      | `src/bridge/server.ts`, `runtime.ts` | ADAPT |
| `packages/process/src/daemon.ts`              | `src/process/daemon.ts`           | ADAPT   |
| `packages/tunnel/src/cloudflared.ts`          | `src/tunnel/provider.ts`          | ADAPT   |
| `packages/logger/src/index.ts`                | `src/logger/index.ts`             | ADAPT   |

`GENERALIZE` means the code was also de-branded: `CodexSession` →
`BrainSession`/`HarnessSession`, `C2CConversation` → `CollaborationSession`,
and `C2C` control verbs → `A2L` control verbs. See `docs/C2C_REUSE_MAP.md`.

### Architectural inspiration (no copied code)

- Control-plane / data-plane separation (tiny control messages, read-only MCP).
- "The Brain must independently review the real workspace" loop.
- One-action-at-a-time `USER_ACTION_REQUIRED` UX for login / CAPTCHA / 2FA.
- Secret-redacting structured logger.

The MIT license text for C2C is reproduced below.

```text
MIT License

Copyright (c) 2026 codex-with-chatgpt contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Referenced but not copied

These projects were studied for architecture only. No source was copied and no
runtime dependency exists.

- **willio/chat-to-codex** — one connector / multiple brains; workspace
  registry; opaque workspace identifiers.
- **ayshptk/harness-cli** — subprocess abstraction, unified NDJSON event
  normalisation across Codex / Claude Code / Cursor / OpenCode.
- **DeepSeek Harness (dsh)** — "everything is a plugin" architecture; informed
  the capability-probing / graceful-degradation design of
  `packages/harnesses/deepseek-harness`.

## Runtime dependencies

Runtime dependencies keep their own licenses; run `npm ls` in a published
package for the resolved tree. Notable ones: `@modelcontextprotocol/sdk`,
`express`, `zod`, `commander`, `ignore`.
