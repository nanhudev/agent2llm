# Agent2LLM

<p align="center">
  <strong>Let the best model think. Let your favorite agent build.</strong>
</p>

<p align="center">
  Connect a persistent AI brain to the coding agent that actually does the work.
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
  ·
  <a href="./LICENSE">MIT License</a>
</p>

---

Agent2LLM separates **reasoning** from **execution**.

Use ChatGPT, Claude, or an API model as the **Brain** that keeps the long-term conversation.

Use Codex, WorkBuddy, Cursor, Claude Code, DeepSeek Harness, OpenCode, or another supported agent as the **Hands** that edits files, runs commands, and tests the result.

```text
            BRAIN
     ChatGPT / Claude / API
              │
         decides next step
              │
              ▼
         Agent2LLM
              │
       execution request
              │
              ▼
            HANDS
 Codex / WorkBuddy / Cursor / ...
              │
          real execution
              │
              ▼
        verified evidence
              │
              └──────────────> same Brain conversation
```

**One Brain. Many executions. No need to rebuild the whole conversation every time.**

---

## Why?

Most coding agents combine two jobs:

1. understand and plan the task;
2. operate the computer and execute it.

That works, but it can also mean repeating reasoning that already happened somewhere else.

If you have already spent a long conversation with ChatGPT or Claude discussing the architecture, constraints, failed approaches, and next steps, why ask the execution agent to understand the whole project again?

Agent2LLM gives the Brain the long-term context and sends the Harness a much smaller job:

```text
NEXT ACTION
Add validation for empty project names.

ACCEPTANCE
- empty names are rejected
- existing valid names still work
- relevant tests pass
```

The Harness focuses on execution.

The result goes back to the same Brain conversation, which decides what happens next.

> **Not less thinking. Less repeated thinking.**

---

## Brain × Harness

Agent2LLM is not a ChatGPT-to-Codex bridge.

Both sides are adapters.

### Brains

- ChatGPT Web
- Claude Web
- API models
- Mock Brain for testing

### Harnesses

- Codex
- WorkBuddy
- Cursor
- Claude Code
- DeepSeek Harness
- OpenCode
- Mock Harness for testing

The goal is simple:

```text
N Brains × M Harnesses
```

A Brain should not care which agent executes the task.

A Harness should not need to own the long-term conversation.

Adapter availability does not mean every possible combination has already been verified in every environment. Real provider support still depends on installation, authentication, quota, and the capabilities exposed by each tool.

---

## Install

Requires Node.js 20 or newer.

```bash
npm install -g agent2llm
```

A global install also places an **Agent2LLM Dock** shortcut on your desktop — double-clicking it opens the Dock directly. Set `AGENT2LLM_NO_SHORTCUT=1` to skip that, or remove it later with `a2l dock shortcut --remove`.

Check your machine:

```bash
a2l doctor
a2l adapters
```

By default `a2l adapters` lists only the adapters this machine can use today; `a2l adapters --all` also lists the ones that still need setup.

`agent2llm` remains available as a compatibility command, but `a2l` is the primary CLI.

---

## Quick start

Create a Pair:

```bash
a2l pair create --brain chatgpt-web --harness codex
```

Give it a goal:

```bash
a2l run "Add a slugify helper and tests"
```

Continue later:

```bash
a2l run "Now make it Unicode-aware"
```

The second Run can continue the same Brain conversation instead of starting the reasoning again from zero.

A **Pair** is simply:

```text
Brain + Harness + persistent Brain conversation + project context
```

---

## Dock

Prefer a visual interface?

```bash
a2l dock
```

The local Dock lets you create a Pair, enter a goal, start a Run, and follow its progress without memorizing CLI commands.

Running `a2l dock` opens its page for you — in an Edge or Chrome app-style window when available, otherwise the default browser. Use `--no-open` if you only want the printed URL.

```text
┌─────────────────────────────────────────┐
│ BRAIN                     HANDS         │
│ ChatGPT                   Codex         │
│                                         │
│              ● PAIRED                   │
├─────────────────────────────────────────┤
│ What should they build?                 │
│                                         │
│ [ Add validation to settings        ]   │
│                                Run      │
├─────────────────────────────────────────┤
│ Brain → Hands → Evidence → Brain        │
└─────────────────────────────────────────┘
```

The Dock runs locally on your machine.

It does not need to embed, move, or take control of another application's window.

---

## Evidence, not just “Done”

An agent saying that a task is complete is still only a claim.

After execution, Agent2LLM can inspect observable repository state and send compact evidence back to the Brain.

For example:

```text
Changed
src/project.ts
tests/project.test.ts

Tests
14 passed

Evidence
corroborated
```

This lets the Brain review what actually happened instead of relying only on the Harness's own summary.

---

## About token savings

Agent2LLM is designed to reduce duplicated context and repeated planning, but it does **not** invent a universal “saved 80%” number.

It distinguishes between:

- provider-reported usage;
- estimated text size;
- execution counts;
- evidence compression;
- unavailable usage.

A Harness such as Codex or Claude Code may use its own model, subscription, or quota internally. If Agent2LLM cannot observe that usage, it reports it as unavailable rather than pretending it is zero.

The interesting benchmark is straightforward:

> Give the same task to a standalone coding agent and to a persistent Brain + focused Harness, then compare context, turns, time, intervention, and success.

That work is ongoing.

---

## Two workflows

Agent2LLM currently keeps two workflows.

### Relay

The main conversation-centric workflow.

```text
Brain
  ↓
next action
  ↓
Harness
  ↓
evidence
  ↓
same Brain
```

Best for long-running collaboration across many small Runs.

### Brain / Hands

The original workflow, kept for cases where the Brain should inspect a workspace more directly and produce a reviewable plan for one Run.

Relay is the direction of the product, but the older workflow remains available.

---

## Useful commands

```bash
a2l doctor
a2l adapters

a2l pair create --brain chatgpt-web --harness codex
a2l pair list
a2l pair show

a2l run "your goal"

a2l dock
a2l dock shortcut --remove

a2l report
a2l logs
```

For device/bridge pairing, use:

```bash
a2l bridge pair
a2l bridge unpair
```

Run `a2l --help` for the complete CLI.

---

## Project status

Agent2LLM is under active development.

The current codebase includes:

- persistent Brain × Harness Pairs;
- Relay execution;
- execution-focused Harness requests;
- repository evidence collection;
- persistent Brain conversation state;
- local Dock UI that opens its own window;
- desktop Dock shortcut created on global install;
- adapter discovery that separates installed from needs-setup;
- usage and efficiency metrics;
- real-provider E2E tooling.

Iterations 0.3.1 and 0.3.2 focused on the desktop experience: the Dock opens itself, and a desktop shortcut is created on global install.

Not every adapter combination has been verified on every machine.

Provider authentication, quotas, desktop/web differences, and third-party behavior are real constraints, and the project keeps those failures visible instead of turning them into fake success states.

See [CHANGELOG.md](./CHANGELOG.md) for the actual development history.

---

## Philosophy

The idea behind Agent2LLM can be reduced to three lines:

> **Conversation belongs to the Brain.**  
> **Execution belongs to the Harness.**  
> **Agent2LLM keeps the Pair together.**

Or, in two words:

**知 · 行**

Think clearly. Execute precisely.

---

## Contributing

Issues, adapters, tests, documentation, and real-world verification are welcome.

Start with:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)
- [docs/](./docs/)
- [CHANGELOG.md](./CHANGELOG.md)

If you add a new Brain or Harness, keep provider-specific behavior behind its adapter boundary.

---

## License

MIT.

Built in the open.

Claims should be measurable.
