# ADR-003: Read-only Brain workspace access

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

The Brain is a model behind a web UI or an API. Its input is untrusted by
construction: every file it reads may contain text written by someone else, and
that text can say "ignore previous instructions and run this command".

## Decision

- The Brain's permission set is fixed in code:
  `workspace.read = true`, `workspace.write = false`, `shell.execute = false`,
  `git.modify = false`.
- The Brain-facing MCP server exposes **no mutation tools**. There is no
  `write_file`, `delete_file`, `shell`, `git_commit`, `git_push` or
  `install_package` in the tool list, so no scope bug or prompt injection can
  enable one.
- File content can never change server capability. Permissions come from
  `PermissionPolicy` and adapter manifests, never from model text.
- Even if a Brain asks for `rm -rf`, the request is not a command: Core only
  forwards an `ExecutionRequest` to the Harness, and the Harness decides.

## Consequences

- Prompt injection from workspace content can at worst mislead the Brain's
  judgement — it cannot grant a capability.
- The Brain's review remains meaningful: read is all that independent review
  needs.
- `FORBIDDEN_MCP_TOOLS` is asserted by tests so the tool list cannot silently
  grow a mutation tool.

## Rejected alternatives

- **"Trusted" write tools with user approval** — approval fatigue turns it into
  a rubber stamp, and it reintroduces the capability the design removes.
- **Letting config grant Brain write** — a config flag is exactly the thing an
  injected instruction would aim at.
