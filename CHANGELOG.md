# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-16

### Added

**Protocol (`a2l/1`)**

- Finite, verifiable state machine with 14 states
  (`BOOTSTRAP` … `HANDOFF`) and an explicit transition table.
- Typed control envelope validated with Zod; session, task, workspace and
  iteration-monotonicity checked before any state change.
- Web wire format (`[A2L]` text block) that tolerates surrounding prose.
- C2C → A2L state mapping for migration.

**Adapter SDK**

- `BrainAdapter` / `HarnessAdapter` contracts with `AdapterMetadata`,
  `CapabilityManifest`, detection, setup and session lifecycle.
- `AdapterRegistry` plus an external loader for `@agent2llm/*-*` packages with
  `apiVersion` validation.
- Contract suite covering metadata, capabilities, deterministic detection,
  typed setup failures, session lifecycle, cancel safety, idempotent close and
  event schema.

**Core**

- Typed error taxonomy (16 classes), retry with backoff/jitter that never
  retries auth or CAPTCHA, permission policy, capability-based compatibility
  engine, structured events, workflow model.

**Brains**

- `chatgpt-web` (boot prompt + DOM selectors), `claude-web`, `api` (provider
  abstraction), `mock` (scriptable PLAN/REVIEW/DONE/REVISE/BLOCKED).

**Harnesses**

- `deepseek-harness` (capability probing + compatibility layer),
  `workbuddy`, `codex`, `cursor` (IDE + CLI transports), `claude-code`,
  `opencode`, `mock`.

**Runtime**

- Read-only MCP data plane split into workspace / git / execution tool groups.
- Workspace broker with opaque ids, canonical path containment, sensitive-file
  deny list, `.agent2llmignore` and `.c2cignore`, non-git snapshots.
- OAuth 2.1 + PKCE S256 + DCR, rotating refresh tokens, hashed storage,
  one-time pairing codes with TTL/attempt/rate limits.
- `BrowserTransport` (Playwright + manual inbox), subprocess transport.
- Bridge, daemon lifecycle, `TunnelProvider` with a Cloudflare implementation.
- Session model, resume planning and HANDOFF.
- CLI: interactive launcher, `detect`, `doctor`, `setup`, `run`, `session`,
  `workspace`, `pair`, `logs`, `config`, `version`, with `--json`.

**Validation**

- 67 assertions across protocol, adapter-contract, orchestrator,
  workspace-security and auth-security suites.
- Custom lint enforcing module size and no committed secrets.

### Security

- Brain permissions fixed in code: read only, no write, no shell, no git-modify.
- No mutation tools exist in the Brain-facing MCP server.
- Canonical path containment with symlink, junction and case-insensitive
  defences.
- Sensitive-file deny list; `.env.example` remains readable.
- Secret-redacting logger.

### Attribution

- Substantial derivation from `XiaoDuoYa/codex-with-chatgpt` (MIT) documented in
  `docs/C2C_REUSE_MAP.md` and `THIRD_PARTY_NOTICES.md`.
