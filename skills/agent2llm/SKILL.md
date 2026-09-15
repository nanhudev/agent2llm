---
name: agent2llm
description: >
  Use Agent2LLM to connect a reasoning Brain (ChatGPT/Claude/API) to a coding
  Harness (DeepSeek Harness, WorkBuddy, Codex, Cursor, Claude Code, OpenCode).
  Use when the user wants one model to plan/review while another agent executes,
  or wants to verify a Brain x Harness pairing without running a real task.
---

# Agent2LLM skill

## When to use

- "Use ChatGPT as the brain for `<harness>`."
- "Let Claude review what `<harness>` just did."
- "Check whether `<brain>` × `<harness>` is even possible here."

## Mental model

```text
Brain thinks.  Hands act.  Core governs.
```

- The **Brain** reads the workspace through a read-only MCP server. It cannot
  write, run shell, or touch git.
- The **Harness** mutates the workspace.
- **Core** runs the A2L state machine and enforces permissions.

## Commands

```bash
agent2llm detect                       # what is installed (add --json)
agent2llm doctor                       # health with repair hints
agent2llm adapters                     # implemented / detected / verified
agent2llm setup --brain chatgpt-web    # connect a Brain (human logs in)
agent2llm run --brain chatgpt-web --harness dsh --goal "..." --workspace .
agent2llm run --brain X --harness Y --dry-run    # compatibility only
agent2llm session list | resume <id> | stop <id>
agent2llm workspace list | add | remove
```

## Rules for agents

1. **Never invent CLI flags.** If you need a harness flag, check
   `agent2llm detect --json` and the adapter doc under `docs/adapters/`.
2. **Prefer `--dry-run` first.** It resolves capability compatibility without
   contacting any product.
3. **Trust evidence over claims.** When reviewing a run, use `git_diff`,
   `changed_files`, `test_status` and `execution_summary` — not the Harness's
   summary of itself.
4. **Report status honestly.** `implemented` is not `verified`. If the machine
   lacks Cursor, say "implemented, not verified here".
5. **Never grant the Brain write access** to work around a blocked step. If a
   step needs writing, it belongs to the Harness.
6. **One human action at a time.** Login, CAPTCHA and 2FA surface as
   `USER_ACTION_REQUIRED`; wait instead of retrying.

## Adding an adapter

See `CONTRIBUTING.md`. In short: extend `BrainAdapterBase` or
`HarnessAdapterBase`, declare only real capabilities, register it, document the
verification status, and make the contract suite pass.
