# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-09-17

### Added

- **The dock teaches the model it runs on, and can now do the whole job.**
  The dock page (PHASE 7–11 work, five changes):
  - The page opens by stating the mental model — one Pair is one Brain × one
    Harness, the Brain holding the conversation across goals, the Harness the
    hands working in a folder — where the pairs render under it.
  - **A first Pair can be made on the page.** `POST /api/pairs` sits behind
    the same gates as a run (one-time token, compared `Origin`, JSON-only
    body) and calls `createPairCore`, the function `a2l pair create` was
    refactored to share, so a pair made on the page and one made in a
    terminal are indistinguishable on disk. `GET /api/catalog` offers the
    registry's own adapters with their roles, so the form can only offer
    what exists.
  - **A run in flight is no longer mute.** The page polls `/api/state` —
    which the server already maintains — and shows seconds elapsed, the
    tail of the orchestration's operational lines, and any approval the
    harness asked for. Operational sentences only, never the Brain's
    reasoning.
  - **Run failures answer what, where and next**, with the server supplying
    the next step where one genuinely exists (409 → wait; 404 → create the
    pair; no context → open the harness on a folder or create the pair with
    a workspace) and the raw message kept in a collapsed details block. A
    run blocked on approvals lists them and says plainly that the page
    cannot answer them.
  - **The result panel reports metrics with strict accounting semantics:**
    the Brain's spend is provider-reported (with its parts), unavailable
    (with its reason), or not measured — never a fabricated 0; the test
    count is a number or an honest null; measured text sizes are labelled
    as estimates; and there is no cost figure anywhere.
- **Single-executable packaging (Windows `.exe`, macOS `.dmg`, Linux binary).**
  `npm run package:sea` builds a self-contained executable with Node SEA
  (`scripts/package-sea.mjs`): an extra CommonJS bundle in which zod, express,
  ignore and the MCP SDK are embedded (an executable has no node_modules),
  while playwright stays external and degrades to the manual transport. A
  tag-triggered `.github/workflows/release.yml` builds the Windows exe, a
  macOS `.dmg` (hdiutil) and a Linux binary, runs a mock goal through each
  packaged executable before it is uploaded, and only uploads artifacts — it
  never cuts a release. The binaries are unsigned: SmartScreen/Gatekeeper
  will warn on first run, and that is stated rather than papered over.

### Changed

- **`a2l` is the command the product prints.** Help text, first-run hints and
  the deprecation notices now say `a2l …`; the full `agent2llm` spelling
  remains a working binary. Product identity is centralized in
  `@agent2llm/config` (`PRODUCT_NAME`, `PRODUCT_SHORT_NAME`, `CLI_PRIMARY_NAME`,
  `LEGACY_NAMES`), so a future rename is a constants change rather than a hunt
  through every file. The `a2l/1` protocol, state directories and persisted
  identifiers are untouched.
- **Device pairing moved under the bridge namespace.** The word "pair" named
  two unrelated things: the Brain×Harness Pair that Relay Mode runs through,
  and workspace-vs-bridge device pairing that only shared the vocabulary.
  Device pairing now answers to `a2l bridge pair <workspace>` and
  `a2l bridge unpair [workspace]`. The old `a2l pair <workspace>` /
  `a2l unpair` spellings keep working — no script breaks — and each use
  prints a deprecation notice pointing at the new command. The Pair domain
  (`pair create` / `list` / `show` / `remove`) is unchanged.

### Fixed

- **Harnesses installed by `npm install -g` could not be executed on Windows.**
  Discovery reported the extensionless POSIX shim npm writes next to the
  `.cmd`, but Node refuses to spawn such a file, so every dispatch died with
  `EINVAL` right after `detect` had reported the tool's version. CLI harnesses
  now launch an extensionless shim through its shebang interpreter, the same
  route the version probe already used, passing argv untouched.
- **A harness's stderr reason is no longer denied in failure summaries.**
  When a failing harness printed its only readable explanation on stderr
  (`dsh: UNKNOWN_MODEL: …`) and nothing on stdout, the failure sentence
  claimed there was "no readable message". The summary now falls back to the
  last meaningful stderr line when stdout has none.
- **The browser-capability probe survives CommonJS output.** The probe's
  `createRequire(import.meta.url)` ran at module load; in the CommonJS bundle
  used by the single-executable build esbuild empties `import.meta`, which
  would have crashed the CLI before any command ran. It now falls back to the
  executable itself, where the probe answers `installed:false` — the honest
  answer for a binary without node_modules (CDP attach and the manual
  transport keep working). The ESM build, the one npm ships, is unaffected.
- **Usage terminology: harness model usage is unknown, not zero.** The 0.2.0
  notes said the harness side of every run is "0 brain tokens by construction,
  because execution never consults a model". Agent2LLM cannot know that: a
  harness such as Codex, Cursor or Claude Code may be running its own model on
  its own subscription while it executes, and nothing in the protocol lets
  Agent2LLM observe it. `agent2llm report` now says harness usage is not shown
  unless an adapter reports it, and run metrics carry a `harnessUsage` field
  (`null` = unreported) alongside the Brain's, so a future harness that does
  report trustworthy provider usage has somewhere honest to put it rather than
  a default of 0. The 0.2.0 text below is left exactly as it was written — it
  records what that release said, and this entry records why it was wrong.

## [0.2.0] — 2026-09-17

Everything below this heading was written after the 0.1.0 tag and is shipping
for the first time in 0.2.0.

### Relay Mode — one conversation, many goals

- **`a2l pair` and a relay-aware `a2l run`.** A Pair is the durable thing: it
  holds the Brain's conversation pointer, the Harness identity, the resolved
  context and the execution policy. `a2l run "goal"` uses the active pair, so
  run 4 continues the same Brain thread run 1 opened. `--brain X --harness Y`
  without `--relay` still means brain-hands, byte for byte.
- **Execution-only dispatch.** A Relay step is sent as a `NEXT_ACTION` plus its
  acceptance criteria, and deliberately without the run's goal — handing a
  Harness a goal is an invitation to re-derive the plan the Brain already made.
  Asserted negatively in `tests/relay.test.mjs`: the brief must not contain the
  goal string.
- **Evidence read from git, not from the Harness.** After each dispatch,
  Agent2LLM collects the real working-tree state and forms a verdict
  (`corroborated` / `unverified` / `contradicted`) before the Brain is told
  anything. A Harness that claims files in a clean tree is recorded as
  contradicting itself. `SHOW_DIFF <path>` answers an on-demand detail request
  from the repository, under a bounded request count.
- **The run status is the record, not the Brain's verdict.** `contradicted`
  evidence, and separately *every* dispatch failing, both resolve to `blocked`.
  The second rule was found by running against real Codex: two dispatches came
  back `403 Forbidden` and the run still reported `done` with exit code 0.
- **Harness-owned context.** `getActiveContext()` is an optional adapter hook.
  Codex implements it by reading the newest rollout's `session_meta` `cwd` under
  `$CODEX_HOME/sessions`, skipping Codex-managed roots and refusing roots that
  no longer exist; WorkBuddy reports `null` rather than reversing a lossy slug
  path. A pair follows the Harness when it moves to a new folder and says so
  when another pair already covers that folder.
- **A folder you name wins.** `--workspace` outranks the Harness's report in
  every mode. It previously lost to the Harness in relay mode, which made
  `a2l run "..." --workspace D:\my-repo` edit whatever folder Codex last had
  open and report success. The CLI now also names the folder it ignored.
- **`a2l dock`** — a page on `127.0.0.1` listing pairs with a goal box each.
  Loopback only (there is no `--host`), one-time token on every route,
  JSON-only bodies, no CORS, no cookies, cross-origin POST refused, and 409
  rather than a queue for a second concurrent run. It holds no window handle at
  all, so it cannot move or reparent another application's window.
- **Honest metrics.** Provider-reported tokens where a provider reports them;
  `unavailable` with a reason where it does not (a web Brain is
  subscription-metered); byte-derived *estimated text tokens* labelled as
  estimates, never presented as a billing figure.
- **`npm run e2e:relay`** — end-to-end acceptance against a scratch git
  repository and a real harness, reading every claim back out of git and the
  run record. Deliberately not part of `npm test`: it spends provider quota and
  needs a signed-in harness, so a failure is a fact about the machine — and the
  script reports which, per check, with an explicit `not applicable` state.
- **`A2L_MOCK_BRAIN_SCRIPT`** lets the mock Brain read its plan from a JSON file
  so the real CLI can drive it; a malformed script throws rather than falling
  back, because a run that quietly executed a different plan than the one on
  disk cannot be cited as evidence.

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

- **`ui.fail` / `ui.warn` / `ui.ok` printed nothing at all.** They were colour
  helpers that returned a string, and eighteen call sites used them as printers:
  `a2l run` with no adapters installed, `a2l config set <bad-key>` and
  `a2l session stop <bad-id>` all failed in total silence. A name that can be
  either a value or an action cannot be told apart at the call site, so colouring
  moved to `red`/`yellow`/`green`/`cyan` and the three outcome printers now speak.
- **A CLI harness reported "not installed" for a binary it was about to run.**
  `execute()` called `requireBinary()` before `resolveFlags()`, so an adapter
  that had not probed answered before anything had looked. brain-hands never
  noticed because it probes by accident — `assertCompatible` asks for
  `capabilities()` — but Relay negotiates no capabilities, so every dispatch
  failed with an install error for a binary `a2l detect` named by path.
- **A boolean flag ate the argument after it.** `a2l run --relay "fix the login
  bug"` parsed as `relay: "fix the login bug"` and the goal disappeared. Boolean
  flags are now declared, and `--flag=true` still works.

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
