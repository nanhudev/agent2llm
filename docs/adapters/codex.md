# Harness adapter: Codex

- **Id:** `codex`
- **Role:** `harness`
- **Local detection:** not installed on this machine

## Scope

Codex × ChatGPT is already proven by C2C, so this adapter targets
**compatibility, migration and generic protocol mapping** rather than
re-proving the pairing.

```
C2C semantics  ──►  A2L semantics
C2C INIT       ->   A2L INIT
C2C PLAN       ->   A2L PLAN
C2C EXECUTED   ->   A2L EXECUTED
C2C DONE       ->   A2L DONE
C2C HANDOFF    ->   A2L HANDOFF
```

The mapping lives in `packages/protocol/src/c2c.ts`; unknown C2C states map to
`null`, never to a guess.

## Command shape

The adapter runs the Codex CLI non-interactively, using only flags it verified
present via help output:

```text
codex exec [--json] [--cd <workspaceRoot>] [--sandbox workspace-write]
           [--color never] [--skip-git-repo-check] <rendered task>

codex resume <sessionRef>    (only when the resume subcommand exists)
```

## Capabilities

```text
session.create   task.execute    workspace.read   workspace.write
shell.execute    git.inspect     git.modify
session.attach / session.resume  — only when the resume subcommand is present
structuredOutput                 — only when --json is present
```

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Binary detected | **no** — not installed here |
| Real E2E | **unverified** |
