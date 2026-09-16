# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Window attach transport.** Web Brains can now drive a Chromium window that is
  already open — a desktop build, or the user's own Edge/Chrome — over the
  DevTools protocol, and it is tried before launching a browser. `--endpoint`
  (or `AGENT2LLM_ATTACH_ENDPOINT`) selects it explicitly. `cdp` joins the
  transport enum in the capability manifest.
- Desktop application sensing (`packages/transports/src/desktop.ts`): reports an
  executable on disk, whether a process is running, and a DevTools endpoint only
  when one actually answered.
- **Profile-based port discovery.** A window that never announced its port is
  found by reading `DevToolsActivePort` from the app's profile before sweeping
  conventional ports. This is what reaches a packaged desktop build, whose engine
  is WebView2 and may be started with `--remote-debugging-port=0`; both the
  unpackaged and the Microsoft Store redirected profile layouts are searched. A
  stale file left behind by an exited process is probed and skipped, not trusted.
- `agent2llm doctor` reports `Window attach` and `ChatGPT desktop` separately
  from browser automation, in that order. The desktop check names the profile it
  found and, when the app publishes no port, the switch that makes it.
- `tests/cdp-attach.test.mjs` drives a real Chromium over CDP and asserts that
  detaching does not close the window it attached to.
- `tests/devtools-active-port.test.mjs` covers profile discovery against both
  layouts, malformed and empty files, unrelated profile directories, and a stale
  file whose process has exited.

### Fixed

- **`waitForReply()` could block until its timeout.** It took its baseline when
  the wait began, so a reply already on screen — exactly what a fast or local
  Brain produces — read as "nothing has changed yet". The baseline is now
  captured when the message is submitted.
- **`open()` silently skipped navigation to hostless URLs.** `about:blank`,
  `data:` and `file:` have an empty host, so a blank tab looked like it was
  already on any hostless target.
- **Probe results raced under `detect`.** Concurrent adapters probing the same
  ports on a tight timeout disagreed about the same window. Answers are now
  cached briefly, so one probe serves them all.
- **`probeBrowserModule()` always answered `installed:false`.** It called
  `require.resolve` from an ESM module, where no `require` binding exists; the
  ReferenceError was swallowed by its own `try`/`catch`. Every Web Brain
  silently degraded to the manual transport even with Playwright installed.

### Changed

- README rewritten around transport selection order, with an explicit list of
  what has not been verified.
- `docs/architecture/browser-transport.md` corrected — it documented a
  `NoBrowserTransport` that never existed in the code.

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
