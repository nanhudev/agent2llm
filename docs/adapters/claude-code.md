# Harness adapter: Claude Code

- **Id:** `claude-code`
- **Role:** `harness`
- **Local detection:** not installed on this machine

## Integration path

Official CLI, non-interactive. No interactive screen scraping.

Verified-flag-only invocation:

```text
claude -p --output-format stream-json [--verbose] [--resume <sessionRef>] <rendered task>
```

If structured output or resume is unavailable, the adapter **degrades the
capability** rather than substituting scraping.

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
| Binary detected | **no** — not installed here |
| Real E2E | **unverified** |
