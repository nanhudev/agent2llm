# ADR-001: Adapter architecture

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

Agent2LLM must let any Brain combine with any Harness
(`N brains × M harnesses`). Early designs that branch on a brand —
`if (brain === "chatgpt" && harness === "dsh")` — collapse the moment a third
adapter appears, and they make "add your own harness" a fork of the repo.

## Decision

Core knows only **roles, capabilities, protocol, events, permissions and
sessions**. Two symmetric interfaces exist: `BrainAdapter` and
`HarnessAdapter`, both declared in `packages/adapter-sdk`.

- Every adapter publishes `AdapterMetadata` (id, name, version, role).
- Every adapter publishes a `CapabilityManifest` describing what it can do
  **and** what it cannot.
- Adapters are registered, not imported: `AdapterRegistry` resolves by id, and
  `packages/adapter-sdk/src/loader.ts` loads external packages
  (`@agent2llm/harness-foo`) after validating `apiVersion`.
- Capabilities that do not exist are **declared missing**, never faked.

## Consequences

- Adding a Harness requires no Core change; a new Brain immediately composes
  with every existing Harness.
- Core cannot special-case a product, which forces awkward product behaviours
  into the adapter where they belong.
- Every adapter must pass the shared contract suite
  (`tests/adapter-contract.test.mjs`), so "implemented" is enforced, not
  asserted in a README.

## Rejected alternatives

- **Whitelist of supported pairs** — O(N×M) maintenance, blocks third parties.
- **One generic "agent" interface** — Brains and Harnesses have genuinely
  different lifecycles (conversation vs. execution); forcing them together
  would leak Harness concepts into Brain code.
