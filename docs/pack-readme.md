# agent2llm

Your best model thinks. Your favorite agent builds.

`agent2llm` (the `a2l` CLI) pairs any AI reasoning client — ChatGPT, Claude,
an API model — with any coding agent — Codex, Cursor, Claude Code, OpenCode,
WorkBuddy, dsh — and runs the loop between them:

```
inspect → plan → dispatch → execute → review → revise → done
```

The Brain plans and reviews. The Harness executes. That separation is
structural, not conventional: the capability model gives every harness
`task.execute`, `workspace.read/write` and `shell.execute`, and none of them
`plan.generate` or `review.perform`. Thinking and typing live on different
sides of the wire, so the part that costs tokens per thought is not the part
that burns them per keystroke.

## Install

```bash
npm install -g agent2llm
```

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

# 3. See what each side can do
agent2llm adapters
```

`doctor` reports, among other checks, window attach (a running Chromium
window on a DevTools port) and which harness executables it found. It never
guesses: a check passes only when the thing it describes actually answered.

## Daily use

```bash
# The default workflow: brain-hands
agent2llm run --brain api --harness workbuddy --goal "refactor auth"

# Attach to a browser window you are already signed into
agent2llm run --brain chatgpt-web --harness codex --goal "fix the flaky test" \
  --endpoint http://127.0.0.1:9222

# What did a run actually cost?
agent2llm report
```

`--json` works on every command that produces structure, so other agents
can drive `agent2llm` programmatically — that is the point of the CLI.

## Where the rest of the documentation lives

The full README — architecture, security model, transport selection,
known gaps (stated honestly, because they are real) — is on GitHub:

https://github.com/nanhudev/agent2llm

Installing agents: see `AGENTS.md` in this package for a machine-oriented
install runbook.

## License

MIT
