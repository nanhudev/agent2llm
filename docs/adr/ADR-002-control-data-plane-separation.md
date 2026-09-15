# ADR-002: Control plane / data plane separation

- **Status:** Accepted
- **Date:** 2026-09-16
- **Inherits:** codex-with-chatgpt (MIT)

## Context

A Brain and a Harness need to exchange two very different kinds of
information: *what should happen next* and *what the workspace actually looks
like*. Mixing them means pushing source code, diffs and logs through a chat
window — slow, lossy, and impossible to secure by shape.

## Decision

Two planes, enforced by different code paths:

**Control plane** — `A2L` messages (`packages/protocol`). Carries state, ids,
counts, summaries, intent and next action. Budget: `< 4 KB`, and `< 1 KB` for
web brains. It must never carry file bodies, large diffs, full logs or archives.

**Data plane** — a read-only MCP server (`packages/mcp`). The Brain pulls
workspace facts on demand, paginated and scope-checked.

The Brain reviews through the data plane. The Harness's own report is treated
as a claim, not as evidence.

## Consequences

- Web brains stay usable: no giant pastes, no context blowup.
- The Brain can catch a Harness that reports success without changing anything,
  because `changed_files` and `git_diff` come from the workspace, not the
  Harness.
- Control messages can be schema-validated cheaply, so protocol violations fail
  loudly instead of corrupting a run.

## Rejected alternatives

- **Send the diff in the control message** — breaks the size budget and makes
  prompt-injection surface enormous.
- **Let the Harness describe the diff** — removes the entire point of
  independent review.
