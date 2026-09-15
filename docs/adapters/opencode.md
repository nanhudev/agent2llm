# Harness adapter: OpenCode

- **Id:** `opencode`
- **Role:** `harness`
- **Local detection:** not installed on this machine
- **Priority:** below DSH / WorkBuddy / Cursor / Claude Code / Codex

## Integration path

Official CLI, non-interactive:

```text
opencode run --format json [--dir <workspaceRoot>] [--session <sessionRef>]
             [--agent <agent>] <rendered task>
```

Every flag is probed before use; a missing `run` subcommand downgrades the
adapter instead of failing at execution time.

## Capabilities

```text
session.create   task.execute    workspace.read   workspace.write
shell.execute    git.inspect     git.modify       supportsHeadless
stream.events / structuredOutput — only when --format exists
session.attach / session.resume  — only when --session exists
```

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Binary detected | **no** — not installed here |
| Real E2E | **unverified** |
