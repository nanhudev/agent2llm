# Agent2LLM

[![CI](https://img.shields.io/badge/CI-ready-blue)](./.github/ci/github-actions.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Protocol](https://img.shields.io/badge/protocol-a2l%2F1-blue.svg)](./docs/protocol/a2l-protocol.md)

English · [简体中文](./README.zh-CN.md)

Use ChatGPT or Claude as the reasoning brain behind DeepSeek Harness, WorkBuddy,
Codex, Cursor, Claude Code or OpenCode.

```text
N Brain Adapters  ×  M Harness Adapters  =  N × M composability
```

## Why this exists

[XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
showed that a chat box can carry a control plane: ChatGPT plans, Codex executes,
and a small text protocol moves between them. That work is good, and it is welded
to Codex — one brain, one harness.

Agent2LLM keeps the idea and drops the welding. Brain and Harness sit on either
side of an adapter boundary, so any brain can drive any harness:

- Brains: `chatgpt-web`, `claude-web`, `api`, `mock-brain`
- Harnesses: `dsh`, `workbuddy`, `codex`, `cursor`, `claude-code`, `opencode`,
  `mock-harness`

Adding one does not change the other. That is the whole design.

## How it works

Two planes, kept separate on purpose.

```text
Brain                    Control plane: state, ids, counts, intent.
  │                      Budget < 4 KB, < 1 KB over a web UI.
  │ control (small)
  ▼
Agent2LLM Core
  │
  ├── read-only MCP ──> Workspace      The Brain pulls what it needs.
  │
  └── ExecutionRequest ──> Harness ──> mutates Workspace
```

The split exists for one reason: **the Brain reviews the workspace, not the
Harness's summary of it.** A Harness saying "tests pass" is a claim. `git_diff`
is evidence. So the Brain gets a read-only view of the real thing.

The Brain-facing MCP server has no `write_file`, no `shell`, no `git_commit`,
no `install_package`. Those tools do not exist in it. The Brain decides; the
Harness acts.

## Install

```bash
npm install -g agent2llm
```

Or without installing:

```bash
npx agent2llm doctor
```

Requires **Node.js >= 20**. Playwright ships as an optional dependency for the
browser transports; without it, web brains fall back to the manual transport
and everything else keeps working.

Installing from source is still there when you need it:

```bash
git clone https://github.com/nanhudev/agent2llm.git
cd agent2llm
npm install
npm run build
node apps/cli/dist/index.js version
```

## Quick start

```bash
agent2llm                 # interactive launcher
agent2llm detect          # what is installed on this machine
agent2llm doctor          # health checks, with repairs
agent2llm adapters        # implemented / detected / verified, per adapter
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

Check a pairing without contacting any product:

```bash
agent2llm run --brain chatgpt-web --harness workbuddy --dry-run
```

What the thinking actually cost:

```bash
agent2llm report
```

The Brain is the only side that spends tokens, and it only thinks during
inspect / plan / review. The report prints what the provider actually billed,
per session and per phase — and the harness side of every run is 0 brain
tokens by construction, because execution never consults a model. Web brains
are subscription-metered and report nothing; nothing is estimated to fill
that gap.

## Driving a browser you already have open

The ChatGPT and Claude Web Brains need a browser. Getting one is the part people
get wrong, so it is worth being explicit about the three options and the order
they are tried in.

| Order | Mode | What happens | Cost |
| --- | --- | --- | --- |
| 1 | `cdp` | Attach to a window that is already open | none — you are already signed in |
| 2 | `playwright` | Launch a browser with its own profile | you sign in again; a fresh Chromium is what anti-automation checks look for |
| 3 | `manual` | Agent2LLM writes the message to a file, you paste it | slow, always works, no dependencies |

Attaching is preferred because it is cheaper and steadier: the session lives in
a window you can watch, it survives between CLI runs, and you never log in twice.

**It is not a desktop-app-specific feature.** The transport speaks DevTools, so
anything that exposes a DevTools port can be driven — the desktop build, or your
own Edge/Chrome. There is no per-application adapter to maintain.

### About the desktop build

Measured on Windows against the official app (`OpenAI.Codex`, Start-menu name
**ChatGPT**), so this is observation rather than inference:

- It is a **full Chromium**, not a WebView2 host. `--remote-debugging-port`
  goes on the executable's own command line; no WebView2 variable is involved.
  It answers `/json/version` as `Chrome/152.0.7977.83`.
- It keeps its profile inside its MSIX package
  (`…\Packages\OpenAI.Codex_…\LocalCache\Roaming\Codex\web\Codex`), which is why
  port guessing alone does not find it and the profile file matters.

```powershell
& "C:\Program Files\WindowsApps\OpenAI.Codex_*\app\ChatGPT.exe" --remote-debugging-port=9222
```

Then `agent2llm doctor` reports `✓ Window attach`.

**Attaching works. Driving the website does not.** The app renders its own
interface at `app://-/index.html` — it does not embed `chatgpt.com`, and
navigating that page elsewhere is refused. So the chat selectors, which describe
the website, describe nothing here. This is why `chatgpt-web` refuses a session
against a shell with an explanatory error instead of waiting for a composer that
will never appear. Use the web app in a browser window for an automated Brain;
attach to the desktop app only for the *other* Brains that talk to a
conversation URL.

That distinction is the honest answer to "can the desktop build be the primary
driver?" — not yet. It can be attached to and read; it cannot be driven by the
website selectors until someone writes selectors for its own DOM.

### Attaching to Edge or Chrome

Start a window with a debug port. Edge is what this was tested against:

```bash
msedge --remote-debugging-port=9222 --user-data-dir=%LOCALAPPDATA%\a2l-window
```

Then confirm it is seen and run:

```bash
agent2llm doctor                       # the 'Window attach' check should say PASS
agent2llm run --brain chatgpt-web --harness workbuddy \
  --goal "Add a README badge" \
  --endpoint http://127.0.0.1:9222
```

`--endpoint` is a shortcut for `AGENT2LLM_ATTACH_ENDPOINT`. With neither, ports
named by a profile file are tried first, then 9222, 9223 and 9229.

You do not have to pick the port. Chromium writes whichever port it bound into
`DevToolsActivePort` in its profile, and the transport reads that file before it
sweeps anything, so `--remote-debugging-port=0` works, as does a port that
changes between runs. Both the ordinary layout and the several depths a Microsoft
Store package redirects to are searched. A profile file whose process has exited
is not treated as a window: nothing answers on it, so it is probed and skipped
like any other dead endpoint.

A profile directory is only reported as the app's when a process is holding it —
a `lockfile` beside the port file. Without that check the app data root yields
false positives, because it collects leftovers from other programs: on the
machine this was developed on, an unrelated Edge profile sat at a path almost
identical to the desktop app's.

A port is only treated as attachable when `/json/version` answers on it and names
the engine. An open socket is not evidence, and guessing turns "no window" into a
confusing protocol error later. Detaching ends our session; it does not close the
window, which `tests/cdp-attach.test.mjs` asserts.

What has actually been exercised: attaching, a round trip, and surviving a
detach, against an Edge 153 window started with an explicit port; against a
Chromium that bound a random port and announced it only through its profile file;
and against the official ChatGPT desktop build, where the attach, a DOM read of
its real interface and the detach were all confirmed.

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

`--json` works on `detect`, `doctor`, `adapters`, `session` and the rest, so other
agents can consume the output.

## Adapter status

Taken from `agent2llm adapters` on the development machine. Legend:
**implemented** = code complete and the contract suite is green ·
**detected** = found on this machine · **verified** = an end-to-end run was
actually observed.

| Adapter | Role | Status | End-to-end |
| --- | --- | --- | --- |
| `mock-brain` | brain | verified | yes |
| `chatgpt-web` | brain | implemented | not run — needs a login |
| `claude-web` | brain | implemented | not run — needs a login |
| `api` | brain | implemented | not run — needs a key |
| `workbuddy` | harness | detected (`codebuddy` 2.137.1) | not run |
| `dsh` | harness | detected (`dsh` 0.1.2-rc.1) | not run |
| `codex` | harness | implemented | not installed here |
| `cursor` | harness | implemented | not installed here |
| `claude-code` | harness | implemented | not installed here |
| `opencode` | harness | implemented | not installed here |
| `mock-harness` | harness | verified | yes |

The API Brain is the one Brain without an MCP client of its own, so it gets the
read-only tool surface in-process and reaches it through provider tool calling.
Without a data plane it declares no workspace access rather than pretending —
see [`docs/adapters/api.md`](docs/adapters/api.md).

## Known gaps

Listed because they are real, not because they are interesting.

- Only the `mock-brain` × `mock-harness` pair has been run end to end. Everything
  else is contract-tested and dry-run checked.
- Nothing has been verified against a live ChatGPT or Claude account from this
  machine. The browser transport is verified up to a page loading; login, MCP
  pairing and a full turn are not.
- The desktop build can be attached to and read, but not driven: it serves its
  own interface from `app://` rather than loading `chatgpt.com`, so the website
  selectors do not describe it. `chatgpt-web` refuses such a session explicitly
  rather than waiting for a composer that will never appear.
- Web Brains scrape a UI, so selectors break when the site changes. The selectors
  are in one file per Brain, on purpose.
- `chatgpt.com` must be reachable. Cloudflare answers a headless Chromium with
  403; the transport runs headed, and login, CAPTCHA and 2FA are always completed
  by a person in the real UI, never automated around.
- CI ships disabled — see [Enabling CI](#enabling-ci).

## Security model

- **The Brain cannot write.** No `write_file`, `shell`, `git_commit` or
  `install_package` exists in the Brain-facing tool surface.
- **File content cannot grant capability.** Permissions come from code and
  config, never from model text. A prompt injection can mislead judgement; it
  cannot hand out a shell.
- **Canonical path containment.** `../`, absolute paths, symlinks, directory
  symlinks, junctions and case tricks all fail closed.
- **Sensitive files are denied.** `.env`, keys, SSH and cloud credentials, token
  files, auth databases, browser profiles. `.env.example` stays readable.
- **Opaque workspace ids.** The Brain sees `a2lw_…`, never a filesystem path.
- **OAuth 2.1 + PKCE S256 + DCR**, rotating refresh tokens, hashed at rest,
  one-time pairing codes with TTL and rate limits.
- **Redacted logs.** Tokens, pairing codes, keys, cookies, auth headers.
- **No reverse proxy, no cookie theft, no private-API interception.** Login,
  CAPTCHA and 2FA are done by you, in the official interface.

Full model: [`docs/security/threat-model.md`](docs/security/threat-model.md).

## Writing a harness

One class, one manifest:

```ts
export class MyHarness extends HarnessAdapterBase {
  metadata() {
    return { id: "my-harness", name: "My Harness", version: "0.1.0", role: "harness" };
  }
  async capabilities() { /* declare what really exists */ }
  async execute(session, task) { /* actually run it */ }
}
```

Publish it as `@agent2llm/harness-my-harness` with an `apiVersion` in the
manifest, and it composes with every Brain above without a change to Core.

## Upstream attribution

Agent2LLM adapts substantial, security-critical code from
[`XiaoDuoYa/codex-with-chatgpt`](https://github.com/XiaoDuoYa/codex-with-chatgpt)
(MIT): OAuth/PKCE/pairing, workspace containment, read-only MCP, execution
records, tunnel and daemon lifecycle, the redacting logger. See
[`docs/C2C_REUSE_MAP.md`](docs/C2C_REUSE_MAP.md) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The protocol here is A2L (`a2l/1`), not C2C. A state mapping is kept for
migration.

## Development

```bash
npm run build       # tsc -b
npm run typecheck
npm test            # protocol, contract, security, orchestrator, transports
npm run lint
npm run verify
```

Tests are plain Node scripts — there is no test framework to install. Each file
runs in its own process against an isolated `AGENT2LLM_STATE_DIR`. The transport
suite starts a real Chromium where one is available and reports itself as skipped
where it is not, so the same command means the same thing on every machine.

### Browser engine (optional)

The Web Brains drive the official UI through Playwright. It is optional: without
it, a Web Brain still runs over `cdp` or the manual transport.

```bash
npm i -D playwright
npx playwright install chromium
```

Chromium is roughly 310 MB. To keep it off the system drive, either set
`PLAYWRIGHT_BROWSERS_PATH` before installing, or install to the default location
and put a directory junction there pointing at another disk — the junction needs
no environment variable at run time.

### Enabling CI

The workflow ships at
[`.github/ci/github-actions.yml`](.github/ci/github-actions.yml) — Linux, Windows
and macOS across Node 20 and 22 — rather than under `.github/workflows/`, because
GitHub rejects any push touching that directory unless the credential carries the
`workflow` scope, and a push is atomic: one rejected file rejects all of them.

```bash
node scripts/enable-ci.mjs    # copies it to .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions workflow"
```

That push needs a token with both `repo` and `workflow` scopes.

## Docs

- [Architecture](docs/architecture/overview.md) ·
  [Adapters](docs/architecture/adapters.md) ·
  [Browser transport](docs/architecture/browser-transport.md) ·
  [Workspace broker](docs/architecture/workspace-broker.md)
- [A2L protocol](docs/protocol/a2l-protocol.md) ·
  [State machine](docs/protocol/state-machine.md)
- [Threat model](docs/security/threat-model.md) ·
  [Workspace isolation](docs/security/workspace-isolation.md)
- [Workflows](docs/workflows/README.md) · [Troubleshooting](docs/troubleshooting.md)
- [ADRs](docs/adr/) · [Prior art: C2C](docs/prior-art/C2C.md)

## License

MIT — see [LICENSE](LICENSE).
