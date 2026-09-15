# Harness adapter: WorkBuddy

- **Id:** `workbuddy`
- **Role:** `harness`
- **Local detection:** **detected** — `codebuddy` / `cbc` 2.137.1

## What was actually found on this machine

Agent2LLM does not invent CLI flags. The installed CLI was inspected and the
following were confirmed present:

```text
codebuddy (alias: cbc)   version 2.137.1
  -p / --print                 non-interactive (print) mode
  --output-format              structured output (e.g. stream-json)
  --resume <sessionRef>        resume an existing session
  --mcp-config <file>          attach MCP servers
  --model <model>              select a model
```

The adapter uses `hasFlag()` probing before adding each flag, so an older or
newer build that lacks one simply loses that capability instead of crashing.

## Integration surface

- **Primary:** official local CLI in non-interactive print mode with structured
  output and session resume.
- MCP config is passed through when available, so the same read-only workspace
  tools can be attached if the deployment wants them.
- No undocumented entry point is assumed. If only an interactive session were
  possible, the adapter would declare the limitation rather than scrape a TUI.

## Capabilities (when detected)

```text
session.create    task.execute       workspace.read    workspace.write
shell.execute     git.inspect        git.modify        stream.events
structuredOutput  supportsHeadless
session.attach / session.resume  — only when --resume is present
```

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Binary detected | **yes** (`2.137.1`) |
| Real end-to-end task | **not run** — would consume model quota |
