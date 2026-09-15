# AGENT2LLM DELIVERY REPORT

Generated 2026-09-16.

## Repository

| Item | Value |
| --- | --- |
| Path | `D:/dev/agent2llm` |
| Branch | `main` |
| HEAD | `24c6d98` (`24c6d98cc42013e0bb3c7fd2bd6dcb85bf6be898`) |
| Commits | 18, semantic, no "initial commit" dump |
| Working tree | clean |
| Remote | `origin → https://github.com/nanhudev/agent2llm.git` (added) |
| GitHub status | **pending user authorization** — see "GitHub status" below |

## Architecture completed

- **Protocol** — `a2l/1`: 14-state finite machine, Zod-validated envelope,
  web text wire format, C2C→A2L migration mapping.
- **Adapter SDK** — `BrainAdapter` / `HarnessAdapter`, capability manifests,
  registry, external-package loader with `apiVersion` validation.
- **Core** — 16 typed errors, retry with backoff/jitter (never retries auth or
  CAPTCHA), permission policy, capability-based compatibility engine, events,
  workflow model.
- **Runtime** — read-only MCP data plane (workspace / git / execution tool
  groups) plus an in-process `ReadOnlyDataPlane`, workspace broker with opaque
  ids, OAuth 2.1 + PKCE S256 + DCR, one-time pairing, `BrowserTransport`,
  subprocess transport, bridge, daemon, `TunnelProvider`, sessions, resume,
  HANDOFF.
- **Orchestrator** — state machine, control channel, execute/review loop,
  brain-session lifecycle, checkpoint persistence.
- **CLI** — interactive launcher plus `setup / run / detect / doctor /
  adapters / session / workspace / pair / logs / config / version`, all with
  `--json`.

## C2C reused vs rewritten

**Reused (ADAPT, 21 files carry the MIT header):** OAuth 2.1/PKC−/DCR, token
store, scope middleware, pairing manager, workspace containment, ignore rules,
read-only MCP, execution records, bridge, daemon, Cloudflare tunnel, redacting
logger.

**Generalised:** `CodexSession` → `BrainSession`/`HarnessSession`,
`C2CConversation` → `CollaborationSession`, C2C verbs → A2L verbs,
one-bridge-per-workspace → broker + registry, browser control moved out of the
harness into `BrowserTransport`.

**Rewritten:** the whole CLI (different command surface), the protocol name and
envelope, the capability/compatibility engine.

Full table: `docs/C2C_REUSE_MAP.md`. License text: `THIRD_PARTY_NOTICES.md`.

## Brain adapters

| Adapter | Implementation | Detected | Real E2E |
| --- | --- | --- | --- |
| `chatgpt-web` | complete | n/a (web product) | UNVERIFIED — needs login |
| `claude-web` | complete | n/a (web product) | UNVERIFIED — needs login |
| `api` | complete | credential-dependent | UNVERIFIED — needs a key |
| `mock-brain` | complete | yes | **VERIFIED** |

## Harness adapters

| Adapter | Implementation | Detected | Real E2E |
| --- | --- | --- | --- |
| `dsh` | complete | **yes** — `dsh 0.1.2-rc.1` | not run (would spend quota) |
| `workbuddy` | complete | **yes** — `codebuddy` 2.137.1 | not run |
| `codex` | complete | no | UNVERIFIED |
| `cursor` | complete (IDE + CLI transports) | no | UNVERIFIED |
| `claude-code` | complete | no | UNVERIFIED |
| `opencode` | complete | no | UNVERIFIED |
| `mock-harness` | complete | yes | **VERIFIED** |

## Protocol status

IMPLEMENTED + TESTED (14 assertions in `tests/protocol.test.mjs`): illegal
transitions rejected, iteration monotonicity, task/session/workspace mismatch
rejected, `DONE` cannot mutate, only `core` may enter mutation states, HANDOFF
resumption, C2C mapping (unknown → `null`, never guessed).

## Security status

IMPLEMENTED + TESTED: `../` / absolute / symlink / directory-symlink / junction
escapes, `.env` and credential deny list, `.env.example` still readable,
`.agent2llmignore` + `.c2cignore`, PKCE, expired code, code reuse, refresh
replay, wrong client, scope enforcement, rate limit.
29 assertions across `workspace-security` (12) and `auth-security` (17).

## Build / Typecheck / Tests

| Gate | Result |
| --- | --- |
| `npm run build` (tsc -b) | exit 0 |
| `npm run lint` | clean |
| `npm test` | **67 passed, 0 failed** |
| mock E2E (`mock-brain × mock-harness`) | DONE, exit 0 |
| dry-run `chatgpt-web × dsh` | compatible, exit 0 |
| dry-run `claude-web × workbuddy` | compatible, exit 0 |
| dry-run `api × dsh` | compatible, exit 0 |

## Known limitations

- Web brains depend on DOM selectors that can change when the product ships UI
  updates; selectors are isolated in one file per adapter.
- DSH is a developer preview; `DshCompatibilityLayer` probes capabilities
  instead of pinning versions, but upstream may still break it.
- Anthropic provider does not implement tool calling, so with that provider the
  API Brain has no workspace access (declared, not faked).
- Control messages from web brains are parsed from prose; malformed blocks are
  rejected rather than guessed at.
- No npm package published; install from source.

## Unverified third-party integrations

ChatGPT Web, Claude Web, API Brain, Codex, Cursor, Claude Code, OpenCode.
Each is implementation-complete and contract-suite green; none has been run
end-to-end because the products are not installed here, are not logged in, or
running them would consume quota. Absence of Cursor / Claude Code on this
machine is **not** a project defect.

## Important files

```text
README.md  README.zh-CN.md  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
LICENSE  THIRD_PARTY_NOTICES.md
docs/C2C_REUSE_MAP.md
docs/architecture/{overview,adapters,browser-transport,workspace-broker}.md
docs/protocol/{a2l-protocol,state-machine}.md
docs/security/{threat-model,workspace-isolation}.md
docs/adapters/{chatgpt,claude,api,dsh,workbuddy,codex,cursor,claude-code,opencode}.md
docs/workflows/{README,brain-hands,peer}.md
docs/troubleshooting.md
docs/adr/ADR-001..006
docs/prior-art/C2C.md
apps/cli/src/**                    CLI
packages/protocol|adapter-sdk|core orchestration contracts
packages/mcp/src/**                read-only data plane
packages/orchestrator/src/**       run loop
skills/agent2llm/SKILL.md          agent-facing skill
examples/**                        custom adapter skeletons
```

## How to install

```bash
git clone https://github.com/nanhudev/agent2llm.git
cd agent2llm
npm install
npm run build
node apps/cli/dist/index.js version
```

## How to run

```bash
agent2llm                                   # interactive launcher
agent2llm detect                            # --json for machines
agent2llm doctor
agent2llm setup --brain chatgpt-web         # human logs in, official UI
agent2llm run --brain chatgpt-web --harness dsh --goal "Implement dark mode"
agent2llm run --brain claude-web --harness workbuddy --goal "..." --workspace .
agent2llm session resume <id>
```

## GitHub status

The GitHub connector available in this environment is **read-only**
(`create_repository` → HTTP 403), and this machine has no `gh` CLI, no stored
git credential and no `GITHUB_TOKEN`. Creating the repository and pushing
therefore requires one action from the repository owner.

Once authorized:

```bash
cd D:/dev/agent2llm
git push -u origin main
```

## Next recommended real E2E verification

1. `agent2llm setup --brain chatgpt-web` — complete login yourself; confirm the
   MCP connector reaches the workspace.
2. `agent2llm run --brain chatgpt-web --harness dsh --goal "<small real task>"`
   — watch one full PLAN → EXECUTED → REVIEWING → DONE cycle.
3. Repeat once with `--harness workbuddy` to prove Harness swapping needs no
   Brain re-pairing.
4. `agent2llm session resume <id>` after a restart to exercise HANDOFF.
5. Install Cursor / Claude Code and re-run `agent2llm detect` to move those two
   adapters from `implemented` to `detected`.
