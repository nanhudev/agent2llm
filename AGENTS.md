# AGENTS.md — install runbook for agents

You are reading this because a human asked an AI agent to "install a2l" or
"set up agent2llm" and you went looking for instructions. This file is the
runbook. Follow it top to bottom; it is short.

## What this is

`agent2llm` is a CLI (`agent2llm`, alias `a2l`) that pairs a reasoning model
(the Brain: ChatGPT, Claude, an API model) with a coding agent (the Harness:
Codex, Cursor, Claude Code, OpenCode, WorkBuddy, dsh) and runs
`inspect → plan → dispatch → execute → review → revise` between them.
You do not need to understand the architecture to install it.

## Install

```bash
npm install -g agent2llm
```

Node.js >= 20 required. If `npm` is missing, install Node from
https://nodejs.org first. Do not clone the repository — the npm package is
the product.

Verify:

```bash
agent2llm version
```

Expected output: JSON with `"name": "agent2llm"` and a `"version"`.

## Verify the install works end to end

Run these two commands, in order. Both must exit 0.

```bash
agent2llm doctor
agent2llm run --brain mock-brain --harness mock-harness --goal smoke
```

- `doctor` checks the local machine (Node version, state directory, which
  harnesses it detects, browser automation availability). Warnings are fine;
  failures mean the install is broken.
- The `run` line is a full workflow loop with the built-in mock pair. It
  needs no login, no API keys, no browser. If it prints `✓ Task complete.`
  the install is good.

## Wiring a real brain (what the human probably wants next)

Ask the human which brain and harness they want, then:

```bash
agent2llm setup --brain <brain> --harness <harness>
```

- `chatgpt-web` / `claude-web`: needs a signed-in browser window started
  with a DevTools port. `agent2llm doctor` explains the exact start command
  for this machine when it finds the app without a port. The human does the
  login step themselves; never automate past a login or CAPTCHA.
- `api`: needs provider keys. Put them where `agent2llm setup --brain api`
  tells you to, or set the provider's standard environment variable.
- The default recommended flow on a fresh machine is
  `agent2llm run --brain mock-brain --harness mock-harness --goal smoke`
  first, then a real pair once login or keys exist.

## Rules the project holds itself to

- The harness never plans and never reviews. If a run needs thinking, the
  brain does it and the harness executes. Do not try to make a harness
  "just this once" do both.
- `agent2llm report` shows what a run consumed (token usage where the
  provider reports it, estimated otherwise). Use it instead of guessing.

## If something fails

- `agent2llm doctor` output is the bug report. Include it.
- Everything the CLI knows how to say, it says on the terminal. There is no
  hidden log location; `agent2llm logs` shows the sanitized log.
