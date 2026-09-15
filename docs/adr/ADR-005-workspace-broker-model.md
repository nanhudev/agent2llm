# ADR-005: Workspace broker model

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

C2C runs one bridge per workspace. Agent2LLM must support several concurrent
projects (Project A: ChatGPT × DSH, Project B: Claude × Cursor) without letting
one session read another's files.

## Decision

One local broker; many registered workspaces.

- `WorkspaceRegistry` assigns each workspace an **opaque id**
  (`a2lw_…`). The Brain sees the id and a display name — never an absolute
  path.
- Each session binds to exactly one workspace. Tokens are scoped to
  installation + workspace + session.
- Bind to the workspace by resolving the real path once (`fs.realpath`) and
  refusing to serve anything outside it.
- Path safety is canonical: realpath, then containment check. Covers `../`,
  absolute paths, symlinks, directory symlinks, junctions and
  case-insensitive tricks.
- Sensitive files are denied by default (`.env`, `.env.*`, private keys, SSH
  credentials, cloud credentials, token files, auth databases, browser
  profiles). `.env.example` stays readable.
- `.agent2llmignore` is supported; `.c2cignore` keeps working for migrators.

## Consequences

- Multi-project use is a first-class case, and cross-workspace reads fail
  closed.
- A leaked workspace id does not leak a filesystem layout.
- The cost is one registry to maintain and one more place where a bug would
  matter — which is why the security suite is a completion gate.

## Rejected alternatives

- **One bridge per workspace** (C2C) — fine for one project, wasteful and hard
  to reason about for several.
- **Expose real paths to the Brain** — convenient, and a path-disclosure leak.
