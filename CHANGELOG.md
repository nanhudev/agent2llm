# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Installable npm package.** `npm install -g agent2llm` now works: the CLI
  is bundled into one ESM file (`scripts/bundle.mjs`, esbuild), assembled with
  clean publish metadata (`scripts/pack.mjs`), and verified by installing the
  packed tgz into a scratch directory and running `doctor` and the mock
  end-to-end loop from there. Third-party runtime dependencies (zod, express,
  the MCP SDK) stay external and auditable; Playwright ships as an
  optionalDependency.
- **Token usage metrics.** The API Brain records what its provider actually
  billed, per session and per workflow phase (`inspect` / `plan` / `review` /
  `revise`), to `<state>/usage/<session>.jsonl`. `agent2llm report` prints the
  totals. The measurement is also the architectural claim: the harness side of
  every run is 0 brain tokens by construction, because execution never
  consults a model. Web brains are subscription-metered and report nothing;
  nothing is estimated to fill that gap.
- `AGENTS.md`: a runbook for AI agents asked to "install a2l" — install,
  verify with `doctor`, prove the loop with the mock pair, then wire a real
  brain. Pointing an agent at the repository is now a supported install path.
- **Codex Desktop is detected without a standalone CLI.** Codex Desktop stages
  a complete `codex.exe` under `$CODEX_HOME/.sandbox-bin` and keeps it off
  PATH, so `agent2llm detect` used to report Codex as unimplemented on a
  machine where it was installed and signed in. Discovery now probes that root
  (plus `~/.codex/bin`) and, because the directory rotates versioned
  `codex-command-runner-*.exe` files, picks the newest entry rather than a
  fixed filename. Flag probing reads `codex exec --help`, since the top-level
  help only lists subcommands. `packages/detect` gained `homeDirectories()`
  and `newestInDirectory()` for adapters that drive app-managed CLIs.

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
  conventional ports. This is what reaches a packaged desktop build started with
  `--remote-debugging-port=0`, where the OS picks the port; the unpackaged,
  WebView2 and Microsoft Store redirected profile layouts are all searched,
  including the extra `Roaming\Codex\web\Codex` nesting the ChatGPT app uses.
- **Profile ownership test.** A `DevToolsActivePort` file is only trusted when a
  `lockfile` sits beside it — that is what a live process leaves. A file with no
  lockfile is a leftover from an exited run and is reported as ignored rather
  than probed, which stops an unrelated profile from being mistaken for the app.
- **Application-shell detection.** A desktop build that serves its own UI from
  `app://` is recognised as a shell, not a web page. `chatgpt-web` refuses such a
  session with an error naming the cause instead of waiting for a composer that
  will never render.
- `agent2llm doctor` reports `Window attach` and `ChatGPT desktop` separately
  from browser automation, in that order. The desktop check names the profile it
  found and, when the app publishes no port, the switch that makes it.
- `tests/cdp-attach.test.mjs` drives a real Chromium over CDP and asserts that
  detaching does not close the window it attached to.
- `tests/devtools-active-port.test.mjs` covers profile discovery against both
  layouts, malformed and empty files, unrelated profile directories, and a stale
  file whose process has exited.
- `tests/desktop-app.test.mjs` covers the application-shell classification: an
  `app://` window is not a web page, its host is not the target host, and a
  running app that publishes no port does not select `cdp`.
- `AGENT2LLM_ATTACH_PORTS=comma,separated,ports` adds endpoints to discovery,
  for a window whose port nobody can guess — the `--remote-debugging-port=0`
  case where the engine picks the port and no readable profile records it.
- `tests/auth-honesty.test.mjs` covers the authentication rules below.
- **`--quick` is a documented flag, and the only way to get a shallow probe.**
  `agent2llm detect|adapters|brains|harnesses --quick` skips the version and
  `--help` probes. Everything else — including the interactive launcher and
  `doctor` — now runs the real probe, because a capability list is read by a
  human and has to distinguish "absent" from "not looked at".
- **`capabilitiesResolved()` on the CLI harness base class.** Resolving a
  manifest that was never probed now has a name, so a command that is about to
  print capabilities can pay for the flags first instead of printing `false`
  for every one of them.
- **Version probing works through POSIX shims on Windows.** `npm install -g`
  writes a `#!/bin/sh` wrapper, and Windows cannot spawn one — `spawn` reports
  ENOENT, which read as "this binary has no version". The probe now reads the
  shebang and re-invokes the interpreter it names (`sh`, or the program after
  `env`), falling back to npm's `.cmd` sibling when there is no usable
  shebang. `readShebang()` is exported from `packages/detect`.
- `tests/probe-depth.test.mjs` pins the rule that a quick probe may decline to
  answer but may never turn "not measured" into a negative claim, and that
  reading capabilities forces the full probe.

### Fixed

- **Detection reported "not measured" as a fact, and called a working harness
  broken.** Every `detectAll` caller passed `quick: true`, which skips both the
  version probe and the `--help` read. The adapter then answered `hasFlag("exec")`
  for a question nobody had asked, and `false` is indistinguishable from "this
  build genuinely lacks the flag" — so `agent2llm detect` printed
  `version: unknown`, switched every capability off, and stated
  "`codex exec` was not advertised by this build" about a Codex that was
  installed, signed in and working. `detectAll` now defaults to the thorough
  probe, `hasFlag` on an unprobed harness says so instead of answering `false`,
  and the version column distinguishes `unknown` from `-`.
- **A shell error message was printed as a version.** The `shell: true` fallback
  runs through `cmd.exe`, which answers an unrunnable target with
  `'…' 不是内部或外部命令` in the console's own language. Taking the first line
  of that put a Chinese error string in the VERSION column of `agent2llm
  adapters` — worse than an honest `unknown`, because it looks like data. A
  first line that reads as a diagnostic is now rejected.
- **`agent2llm doctor` could not say which version was installed.** It reported
  the reason for detection and stopped, so the question the command exists to
  answer — "what is on this machine" — had no answer for any detected tool. The
  version is now part of the check message.

- **`--endpoint` was ignored by every read-only command.** `selectTransport()`
  honoured `AGENT2LLM_ATTACH_ENDPOINT`, but `doctor` and the desktop-app probe
  called `findAttachEndpoint()` with no arguments, so they swept only the
  conventional ports and reported "no DevTools endpoint answered" about a
  window the user had just pointed them at. The explicit endpoint now outranks
  every heuristic in one place, and `doctor` says which source it searched.
- **A required sign-in blocked every Web Brain run.** `auth.authenticated` was
  a plain boolean, and every adapter that cannot see another product's
  credentials wrote `false`. The compatibility check read that as "not signed
  in" and refused — so no Web Brain ever reached the window a human needs in
  order to sign in. `auth.checked` now distinguishes a measurement from an
  absence of one: unknown warns and the run proceeds, a measured failure still
  refuses. `--ignore-auth` overrides a measurement when the human knows better.
- **The "no endpoint" hint was the same for every cause.** It told the user to
  start a window even when a stale profile file was the actual problem. The
  repair line now names what was searched: the dead endpoint, the stale profile
  port, or the ports swept.

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
- **Desktop-build claims replaced with measurements.** The ChatGPT Windows app
  (`OpenAI.Codex`) is a full Chromium, not a WebView2 host, so
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is not the switch that opens its debug
  port — the flag goes on the executable's own command line. It is attachable and
  readable, but its UI is served from `app://` rather than `chatgpt.com`, so it
  cannot be driven by the website selectors. The manifest limitation, the
  transport and both READMEs now say that instead of the earlier guess.

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
