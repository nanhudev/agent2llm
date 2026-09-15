# Architecture overview

> **Brain thinks. Hands act. Core governs.**

Agent2LLM is a CLI-first, adapter-first, local-first collaboration framework.
It connects a reasoning client (**Brain**) to an execution agent
(**Harness**) without either one owning the other.

It is **not** an API proxy, **not** an OpenAI-compatible gateway, **not** an API
key aggregator, and **not** another coding agent.

## Layer diagram

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
  │ control (small: state, ids, intent)
  ▼
Agent2LLM Core
  │
  ├── read-only MCP ──> Workspace
  │
  └── ExecutionRequest ──> Harness
                              │
                              └── mutates Workspace
```

## Package map

| Package | Owns |
| --- | --- |
| `packages/protocol` | `a2l/1` states, transitions, envelope, capabilities, wire format, C2C mapping |
| `packages/adapter-sdk` | `BrainAdapter` / `HarnessAdapter` contracts, capability manifests, registry, external loader |
| `packages/core` | typed errors, ids, retry, permission policy, compatibility engine, events, workflow model |
| `packages/config` | state dirs, machine config, workspace config, tiny YAML |
| `packages/logger` | secret-redacting structured logger |
| `packages/auth` | OAuth 2.1 + PKCE + DCR, token store, scope middleware |
| `packages/pairing` | one-time pairing codes, TTL, attempt limits, rate limits |
| `packages/workspace` | workspace binding, canonical path containment, ignore rules, git, search, snapshots, registry |
| `packages/execution` | execution records, output release and redaction |
| `packages/mcp` | read-only MCP data plane (workspace / git / execution tool groups) |
| `packages/bridge` | local broker runtime + HTTP surface |
| `packages/process` | daemon lifecycle: start, reuse, health, stop, stale pid cleanup |
| `packages/tunnel` | `TunnelProvider` abstraction + Cloudflare implementation |
| `packages/transports` | `BrowserTransport`, subprocess transport, manual inbox transport |
| `packages/session` | `CollaborationSession` model, store, resume planning, HANDOFF builder |
| `packages/orchestrator` | state machine, control channel, run loop, brain session lifecycle, persistence |
| `packages/detect` | static detection of installed agents (PATH, common locations, app metadata) |
| `packages/brains/*` | chatgpt-web, claude-web, api, mock |
| `packages/harnesses/*` | deepseek-harness, workbuddy, codex, cursor, claude-code, opencode, mock |
| `packages/workflows/*` | brain-hands, peer, planner-only, review-only |
| `apps/cli` | `agent2llm` / `a2l` CLI |

## Why the Core is not "ChatGPT integration"

The Core's domain model is roles and capabilities. ChatGPT, Claude, DSH,
WorkBuddy, Codex, Cursor, Claude Code and OpenCode are all adapters behind the
same two interfaces. A new `MyHarnessAdapter` composes with every existing Brain
with no Core change; that is the project's success criterion.
