# Harness adapter: Cursor

- **Id:** `cursor`
- **Role:** `harness`
- **Local detection:** not installed on this machine

## What "Cursor" means here

**The Cursor IDE Agent**, not "some CLI binary that happens to be called
cursor". `CursorIdeTransport` is a first-class concept; `CursorCliTransport` is
an additional path, not a replacement.

```text
harness-cursor
   ├── CursorIdeTransport    (IDE agent — first-class)
   └── CursorCliTransport    (cursor-agent CLI — additional)
```

## Integration surfaces considered

Official IDE commands, extensions, CLI, automation entry points, background
agents, and MCP/ACP where available. Official interfaces are preferred.

Because Cursor is not installed here, the adapter:

- implements the full adapter shape,
- models capabilities honestly,
- ships transport abstraction, configuration and mock fixtures,
- and reports `implemented / detected:false / verified:false`.

Nothing is faked.

## Command shape (CLI transport)

Only flags verified present in help output are used:

```text
cursor-agent [--print] [--output-format stream-json] [--workspace <root>]
             [--trust] [--force] [--resume <sessionRef>] <rendered task>
```

## Capabilities

```text
session.create   task.execute    workspace.read   workspace.write
shell.execute    git.inspect     git.modify       supportsHeadless
stream.events / structuredOutput — only when --output-format exists
session.attach / session.resume  — only when --resume exists
```

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Binary detected | **no** — Cursor is not installed here |
| Real E2E | **unverified** (absence of Cursor is not a project defect) |
