# agent2llm

Your best model thinks. Your favorite agent builds.

`agent2llm` (the `a2l` CLI) pairs any AI reasoning client — ChatGPT, Claude,
an API model — with any coding agent — Codex, Cursor, Claude Code, OpenCode,
WorkBuddy, dsh — and runs the loop between them:

```
inspect → plan → dispatch → execute → review → revise → done
```

```
pair → run → run → run → …        (one Brain conversation, many goals)
```

Two workflows ship. **Relay** keeps one Brain conversation across many runs and
sends the Harness one step at a time. **Brain / Hands** produces one plan per
run and reviews raw workspace evidence. Relay is opt-in: `--brain X --harness Y`
without `--relay` still means Brain / Hands.

The Brain plans and reviews. The Harness executes. That separation is
structural, not conventional: the capability model gives every harness
`task.execute`, `workspace.read/write` and `shell.execute`, and none of them
`plan.generate` or `review.perform`. Thinking and typing live on different
sides of the wire, so the part that costs tokens per thought is not the part
that burns them per keystroke. In Relay Mode the Brain does not even need
`workspace.read` — the evidence arrives on the protocol.

## Install

```bash
npm install -g agent2llm
```

A global install also places an **Agent2LLM Dock** icon on your desktop.
Double-click it any time: it starts the local dock and opens its page in an
app-style window — no terminal needed. Skip it with `AGENT2LLM_NO_SHORTCUT=1`
(CI environments skip it automatically); recreate or remove it later with
`agent2llm dock shortcut` / `agent2llm dock shortcut --remove`.

Or run it once without installing:

```bash
npx agent2llm doctor
```

Requires Node.js >= 20. Playwright ships as an optional dependency for the
browser transports; without it, web brains degrade to the manual transport
and everything else still works.

## First five minutes

```bash
# 1. What is on this machine?
agent2llm doctor

# 2. Prove the loop end to end with the mock pair (no login, no keys)
agent2llm run --brain mock-brain --harness mock-harness --goal smoke

# 3. See what each side can do — only what this machine can use today,
#    with --all listing adapters that still need setup
agent2llm adapters
```

`agent2llm dock` opens its page by itself — an Edge/Chrome app-style window
when one is present, else your default browser (`--no-open` keeps the old
print-a-URL behaviour).

`doctor` reports, among other checks, window attach (a running Chromium
window on a DevTools port) and which harness executables it found. It never
guesses: a check passes only when the thing it describes actually answered.

## Daily use

Relay — the conversation-centric path:

```bash
agent2llm pair create --brain chatgpt-web --harness codex   # once
agent2llm run "Add a slugify() helper and tests"            # run 1
agent2llm run "Now make it Unicode-aware"                   # run 2, same thread
agent2llm dock                                              # local page, lists your pairs
```

The Harness owns the context: if Codex has a project open, the pair binds to it
and you are not asked for a folder. The run status is the record rather than the
Brain's word — `blocked` means the repository contradicted the last execution,
or every dispatch failed, and the summary quotes the harness's own error.

Brain / Hands, and attaching to a signed-in browser window:

```bash
agent2llm run --brain api --harness workbuddy --goal "refactor auth"

agent2llm run --brain chatgpt-web --harness codex --goal "fix the flaky test" \
  --endpoint http://127.0.0.1:9222

# What did a run actually cost? Provider tokens where a provider reports them,
# `unavailable` with a reason where it does not, estimates labelled as estimates.
agent2llm report
```

`--json` works on every command that produces structure, so other agents
can drive `agent2llm` programmatically — that is the point of the CLI.

## What has not been proven

Relay has never completed a run against a real coding agent. `npm run e2e:relay`
reaches real Codex, dispatches, and reads evidence back out of git — but both
dispatches come back `403 Forbidden`, which is Codex's own account quota on the
machine this was built on. Every Relay acceptance run uses the mock Brain. The
full list is in the "Known gaps" section of the GitHub README.

## Where the rest of the documentation lives

The full README — architecture, security model, transport selection,
known gaps (stated honestly, because they are real) — is on GitHub:

https://github.com/nanhudev/agent2llm

Installing agents: see `AGENTS.md` in this package for a machine-oriented
install runbook.

## License

MIT
