# Agent2LLM

[![CI](https://img.shields.io/badge/CI-ready-blue)](./.github/ci/github-actions.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Protocol](https://img.shields.io/badge/protocol-a2l%2F1-blue.svg)](./docs/protocol/a2l-protocol.md)

English · [简体中文](./README.zh-CN.md)

**Your best model thinks. Your favorite agent builds.**

Use ChatGPT or Claude as the reasoning brain behind DeepSeek Harness,
WorkBuddy, Codex, Cursor, Claude Code and other coding agents.

```text
N Brain Adapters  ×  M Harness Adapters  =  N × M composability
```

---

## Not an API proxy. Not a model gateway. Not another coding agent.

| It is not | It is |
| --- | --- |
| An OpenAI-compatible gateway | A local collaboration runtime |
| An API key aggregator | A role/capability protocol (`a2l/1`) |
| A reverse proxy of ChatGPT or Claude | Official-UI automation with human login |
| A new coding agent | A layer that connects a Brain to your existing agent |

Agent2LLM separates **who thinks** from **who acts**:

```text
Brain thinks.  Hands act.  Core governs.
```

---

## The one idea that matters

> The Brain reviews the **real workspace**, not the Harness's description of it.

A Harness saying "tests pass" is a claim. `git_diff` is evidence. So:

- **Control plane** — tiny A2L messages: state, ids, counts, intent.
  Budget `< 4 KB`, `< 1 KB` for web brains.
- **Data plane** — a read-only MCP server. The Brain pulls what it needs.

---

## Architecture

```text
               Brain Layer

       ChatGPT    Claude     API      Mock
          │         │         │        │
          └────┬────┴────┬────┘        │
               │         │             │
          BrainAdapter (uniform contract)
               │
      ┌────────┴─────────────────────────┐
      │        A2L Protocol / Core       │
      │  state machine · permissions     │
      │  compatibility · sessions        │
      └────────┬─────────────────────────┘
               │
        HarnessAdapter (uniform contract)
               │
   ┌───────────┼────────────┬───────────┐
  DSH      WorkBuddy     Codex      Cursor
   │           │            │           │
Claude Code  OpenCode     Mock      (yours)
```

And the two planes:

```text
Brain
  │ control (small)
  ▼
Agent2LLM Core
  │
  ├── read-only MCP ──> Workspace
  │
  └── ExecutionRequest ──> Harness ──> mutates Workspace
```

---

## Install

Source install (no npm package published yet):

```bash
git clone https://github.com/<you>/agent2llm.git
cd agent2llm
npm install
npm run build
node apps/cli/dist/index.js version
```

Requires **Node.js >= 20**.

---

## Quick start

```bash
agent2llm                 # interactive launcher
agent2llm detect          # what is installed on this machine
agent2llm doctor          # health, with repairs
agent2llm adapters        # implemented / detected / verified, in truthful terms
```

Interactive launcher:

```text
Agent2LLM

Your best model thinks.
Your favorite agent builds.

Brains
✓ ChatGPT
○ Claude
○ API Provider

Harnesses
✓ DeepSeek Harness
✓ WorkBuddy
✓ Codex
○ Cursor
○ Claude Code
○ OpenCode
```

Non-interactive:

```bash
agent2llm run \
  --brain chatgpt-web \
  --harness dsh \
  --workflow brain-hands \
  --workspace . \
  --goal "Implement dark mode"
```

Verify a pairing without contacting any product:

```bash
agent2llm run --brain chatgpt-web --harness workbuddy --dry-run
```

---

## Example session

```text
$ agent2llm run --brain chatgpt-web --harness dsh --goal "Implement authentication"

Starting ChatGPT × DeepSeek Harness

Brain      inspecting workspace...
Brain      plan ready (4 actions)
Harness    executing iteration 1...
Harness    7 files changed, 18 tests passed
Brain      reviewing actual diff...
Brain      revision required
Harness    executing iteration 2...
Brain      reviewing...
Done.
```

The user never sees OAuth scopes, PKCE verifiers, localhost ports or raw
protocol packets. `--verbose`, `--debug` and `--json` are there for when you do
want them.

---

## Commands

```text
agent2llm setup                      Connect a Brain (official UI, human login)
agent2llm run                        Start a collaboration
agent2llm detect                     Detect installed agents
agent2llm doctor                     Health checks with repairs
agent2llm adapters | brains | harnesses
agent2llm session list|show|resume|stop
agent2llm workspace list|add|remove
agent2llm pair | unpair
agent2llm logs
agent2llm config
agent2llm version
```

`--json` works for `detect`, `doctor`, `adapters`, `session` and the rest, so
other agents can consume the output.

---

## Support matrix — honest edition

Captured with `agent2llm adapters` on the development machine:

| Adapter | Role | Status | Real E2E |
| --- | --- | --- | --- |
| `mock-brain` | brain | verified | yes |
| `chatgpt-web` | brain | implemented | **unverified** — needs login |
| `claude-web` | brain | implemented | **unverified** — needs login |
| `api` | brain | implemented | **unverified** — needs a key |
| `workbuddy` | harness | **detected** (`codebuddy` 2.137.1) | not run |
| `codex` | harness | implemented | **unverified** — not installed here |
| `cursor` | harness | implemented | **unverified** — not installed here |
| `claude-code` | harness | implemented | **unverified** — not installed here |
| `opencode` | harness | implemented | **unverified** — not installed here |
| `mock-harness` | harness | verified | yes |

The API Brain is the one Brain with no MCP client of its own, so it gets the
read-only tool surface **in-process** and calls it through provider tool calling.
Without a data plane it declares no workspace access rather than pretending —
see [`docs/adapters/api.md`](docs/adapters/api.md).

Legend: **implemented** = code complete and contract suite green ·
**detected** = found on this machine · **verified** = end-to-end observed.

README never says "fully supported" for anything that has not been verified.

---

## Security model

- **The Brain cannot write.** No `write_file`, `shell`, `git_commit`,
  `install_package` — those tools do not exist in the Brain-facing server.
- **File content cannot grant capability.** Permissions come from code and
  config, never from model text. Prompt injection can mislead judgement, not
  grant a shell.
- **Canonical path containment.** `../`, absolute paths, symlinks, directory
  symlinks, junctions and case tricks all fail closed.
- **Sensitive files denied.** `.env`, keys, SSH/cloud credentials, token files,
  auth databases, browser profiles. `.env.example` stays readable.
- **Opaque workspace ids.** The Brain sees `a2lw_…`, never a filesystem path.
- **OAuth 2.1 + PKCE S256 + DCR**, rotating refresh tokens, hashed storage,
  one-time pairing codes with TTL and rate limits.
- **Redacted logs.** Tokens, pairing codes, keys, cookies, auth headers.
- **No reverse proxy, no cookie theft, no private-API interception.** CAPTCHA,
  2FA and login are completed by you, in the official UI.

Full model: [`docs/security/threat-model.md`](docs/security/threat-model.md).

---

## Add your own harness

Write one class:

```ts
export class MyHarness extends HarnessAdapterBase {
  metadata() { return { id: "my-harness", name: "My Harness", version: "0.1.0", role: "harness" }; }
  async capabilities() { /* declare what really exists */ }
  async execute(session, task) { /* actually run it */ }
}
```

Publish it as `@agent2llm/harness-my-harness` with an `apiVersion` in its
manifest. Then:

```text
ChatGPT   × My Harness
Claude    × My Harness
API Brain × My Harness
```

… all work, with **no change to Core**. That is the project's success criterion.

---

## Upstream attribution

Agent2LLM adapts substantial, security-critical code from
[`XiaoDuoYa/codex-with-chatgpt`](https://github.com/XiaoDuoYa/codex-with-chatgpt)
(MIT) — OAuth/PKC−/pairing, workspace containment, read-only MCP, execution
records, tunnel and daemon lifecycle, redacting logger. See
[`docs/C2C_REUSE_MAP.md`](docs/C2C_REUSE_MAP.md) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The protocol is **A2L** (`a2l/1`), not C2C; a state mapping is kept for
migration.

---

## Development

```bash
npm run build       # tsc -b
npm run typecheck
npm test            # protocol, contract, security, orchestrator — 67 assertions
npm run lint
npm run verify
```

### Enabling CI

The workflow ships at [`.github/ci/github-actions.yml`](.github/ci/github-actions.yml)
(Linux / Windows / macOS × Node 20 / 22) instead of under `.github/workflows/`,
because GitHub rejects any push that touches that directory unless the credential
carries the `workflow` scope. To switch it on:

```bash
node scripts/enable-ci.mjs    # copies it to .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions workflow"
```

That last push needs a token with both `repo` and `workflow` scopes —
create one at <https://github.com/settings/tokens>.

## Docs

- [Architecture overview](docs/architecture/overview.md) ·
  [Adapters](docs/architecture/adapters.md) ·
  [Browser transport](docs/architecture/browser-transport.md) ·
  [Workspace broker](docs/architecture/workspace-broker.md)
- [A2L protocol](docs/protocol/a2l-protocol.md) ·
  [State machine](docs/protocol/state-machine.md)
- [Threat model](docs/security/threat-model.md) ·
  [Workspace isolation](docs/security/workspace-isolation.md)
- [Workflows](docs/workflows/README.md) ·
  [Troubleshooting](docs/troubleshooting.md)
- [ADRs](docs/adr/) · [Prior art: C2C](docs/prior-art/C2C.md)

## License

MIT — see [LICENSE](LICENSE).
