# C2C → Agent2LLM reuse map

Upstream: `XiaoDuoYa/codex-with-chatgpt` v0.1.3 (MIT).
This document was produced from a source-level read of the upstream tree before
any Agent2LLM code was written.

Legend — **Reuse decision**:

| Mark        | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `COPY`      | Used essentially as-is (license header + naming pass only).          |
| `ADAPT`     | Substantially derived; restructured and generalised.                 |
| `GENERALIZE`| Rewritten around a neutral abstraction; upstream logic is the seed.  |
| `REWRITE`   | Upstream approach rejected or unusable; new implementation.          |
| `SKIP`      | Not carried over; out of scope for Agent2LLM.                        |

---

## Core security & plumbing

| Upstream path | Responsibility | Decision | Agent2LLM destination | Modification | Codex-specific dependency | Security implications | Attribution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/auth/oauth.ts` | OAuth 2.1 + PKCE S256 + DCR + rotating refresh | `ADAPT` | `packages/auth/src/oauth.ts` | Medium — provider abstraction, no Codex naming | None | Bearer-token issuance; must not downgrade PKCE | MIT header + notices |
| `src/auth/store.ts` | Hashed token storage, revocation | `ADAPT` | `packages/auth/src/store.ts` | Low | None | Token-at-rest; hashing retained | MIT header |
| `src/auth/middleware.ts` | Bearer/scope enforcement on MCP HTTP | `ADAPT` | `packages/auth/src/middleware.ts` | Medium — scope model extended per tool | None | Per-request authorisation | MIT header |
| `src/pairing/manager.ts` | One-time pairing codes, TTL, attempt limit, rate limit | `COPY` | `packages/pairing/src/manager.ts` | Low | None | Brute-force and replay defence | MIT header |
| `src/workspace/manager.ts` | Canonical-path containment, sensitive-file deny list, pagination | `ADAPT` | `packages/workspace/src/manager.ts` | Medium — registry ids, multi-workspace | None | Primary workspace isolation boundary | MIT header |
| `src/workspace/ignore.ts` | Ignore rules | `ADAPT` | `packages/workspace/src/ignore.ts` | Low — added `.agent2llmignore`, kept `.c2cignore` | None | Prevents key/secret reads | MIT header |
| `src/logger/index.ts` | Secret-redacting structured logger | `ADAPT` | `packages/logger/src/index.ts` | Low | None | Prevents credential leakage to disk | MIT header |

## Data plane

| Upstream path | Responsibility | Decision | Agent2LLM destination | Modification | Codex-specific dependency | Security implications | Attribution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/mcp/server.ts` | Read-only MCP tool surface | `ADAPT` | `packages/mcp/src/server.ts` + `src/tools/{workspace,git,execution}.ts` | High — split into groups, added `changed_files`, `task_checkpoint`, `repository_metadata`, `list_workspaces` | Low | Brain read surface; mutation tools must stay absent | MIT header |
| `src/mcp/http.ts` | Streamable HTTP transport | `ADAPT` | `packages/mcp/src/http.ts` | Low | None | Same auth path as MCP | MIT header |

## Execution evidence

| Upstream path | Responsibility | Decision | Agent2LLM destination | Modification | Codex-specific dependency | Security implications | Attribution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/execution/records.ts` | Execution record model | `ADAPT` | `packages/execution/src/records.ts` | Medium — adapter-agnostic `adapterId`, artifact refs | None | Records are Brain-visible evidence | MIT header |
| (new) | Output release & redaction | `GENERALIZE` | `packages/execution/src/output.ts`, `src/sanitize.ts` | n/a | None | Restricts what output a Brain may read | MIT header (derived policy) |

## Runtime, bridge, tunnel

| Upstream path | Responsibility | Decision | Agent2LLM destination | Modification | Codex-specific dependency | Security implications | Attribution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/bridge/server.ts`, `src/bridge/runtime.ts` | Local bridge, health, runtime state | `ADAPT` | `packages/bridge/src/{server,runtime}.ts` | High — multi-workspace broker instead of one-bridge-per-repo | Low | Network-exposed surface | MIT header |
| `src/process/daemon.ts` | Start / reuse / health / stop / stale pid cleanup | `ADAPT` | `packages/process/src/daemon.ts` | Medium | None | Port + pid hygiene | MIT header |
| `src/tunnel/provider.ts` | Cloudflare quick tunnel | `ADAPT` | `packages/tunnel/src/{provider,cloudflared,factory}.ts` | Medium — provider interface, `none` provider added | None | Public exposure of the bridge | MIT header |
| `src/cli/**` | Codex-specific CLI flow | `REWRITE` | `apps/cli/src/**` | Total — `agent2llm` command surface is different | High | n/a | No code carried |
| `src/codex/**` (if present) | Codex process control | `SKIP` | `packages/harnesses/codex` | n/a | Total | n/a | Architecture reference only |
| `skill/**` | Agent-facing install skill | `GENERALIZE` | `skills/` | Medium | High | n/a | Ideas only |

## Explicitly not reused

| Concern | Why not |
| --- | --- |
| The `C2C` protocol name | Agent2LLM defines `A2L` (`a2l/1`). Reusing the name would misrepresent a different protocol. A state mapping table is provided in `packages/protocol/src/c2c.ts` for migration. |
| One bridge = one workspace | Agent2LLM is a local broker with a workspace registry; the security boundary moves from "process" to "opaque workspace id + token scope". |
| Browser control inside the harness adapter | Agent2LLM extracts `BrowserTransport` (`packages/transports`) so no harness owns the browser. |
| Codex-specific session types | Renamed to role-neutral types (`BrainSession`, `HarnessSession`, `CollaborationSession`). |
| Terminal / ANSI scraping | Rejected as a primary integration path; only used, if ever, behind an explicit capability downgrade. |

## Verification carried over

C2C's security instincts are re-expressed as Agent2LLM tests:

- `tests/workspace-security.test.mjs` — `../`, absolute path, symlink and
  directory-symlink escapes, `.env` / key / credential deny list, ignore rules.
- `tests/auth-security.test.mjs` — PKCE, expired code, code reuse, refresh
  replay, wrong client, wrong scope, rate limit.
- `tests/adapter-contract.test.mjs` — no adapter may claim a capability it does
  not implement; mocks live only in `packages/*/mock`.
