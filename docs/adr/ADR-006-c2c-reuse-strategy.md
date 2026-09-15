# ADR-006: C2C reuse strategy

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

C2C (MIT) already implements the hard parts: OAuth 2.1 + PKCE S256 + DCR,
rotating refresh tokens, pairing codes with TTL and rate limits, canonical-path
containment, sensitive-file filtering, read-only MCP, execution records, tunnel
abstraction, daemon lifecycle, secret-redacting logging and doctor diagnostics.

Rewriting these from scratch is not "original engineering"; it is a reliable way
to reintroduce fixed security bugs.

## Decision

Priority order:

```text
reuse secure proven code
        ↓
generalize naming (Codex/C2C -> Agent2LLM/A2L)
        ↓
extract interfaces
        ↓
add adapters
        ↓
improve architecture
```

- Derived modules carry an
  `ADAPTED FROM codex-with-chatgpt (MIT)` header plus the upstream copyright.
- `docs/C2C_REUSE_MAP.md` records upstream path → destination → decision →
  modification level → security implication.
- `THIRD_PARTY_NOTICES.md` carries the license text.
- The protocol is renamed (`A2L`), and `packages/protocol/src/c2c.ts` keeps an
  explicit mapping for migration.

## Consequences

- The security-critical parts of Agent2LLM inherit reviewed code rather than
  fresh guesses.
- Attribution is auditable at file level, not just in a README.
- Some upstream structure survives that a greenfield design would have
  organised differently — accepted deliberately.

## Rejected alternatives

- **Clean-room rewrite** — slower and less secure.
- **Fork with global rename** (`Codex` → `Agent`) — forbidden by the project
  brief; it produces a superficial derivative rather than a generalised one.
