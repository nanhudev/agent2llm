# Contributing

Thanks for helping. Three rules shape everything below:

1. **No fake adapters.** `async execute() { return { success: true } }` is a bug,
   not an implementation.
2. **Core knows no brands.** If you find yourself writing
   `if (harness === "cursor")`, the logic belongs in the adapter.
3. **Security properties are code, not convention.** If a guarantee matters, a
   test asserts it.

## Setup

```bash
npm install
npm run build
npm test
```

Node.js >= 20.

## Before you open a PR

```bash
npm run typecheck
npm test
npm run lint
```

`npm run lint` enforces two things worth knowing before it annoys you:

- modules stay under 400 lines (split, don't stack),
- no literal secrets in source.

## Adding a Brain

1. Create `packages/brains/<id>/` with a `package.json` (`@agent2llm/brain-<id>`).
2. Extend `BrainAdapterBase` from `@agent2llm/adapter-sdk`.
3. Declare a `CapabilityManifest` that reflects reality. Missing capabilities
   are fine; invented ones are not.
4. Never give a Brain `workspace.write`, `shell.execute` or `git.modify`.
5. Register it in `apps/cli/src/registry.ts`.
6. Add `docs/adapters/<id>.md` with an explicit verification status.
7. The contract suite must pass.

## Adding a Harness

Same shape, with `HarnessAdapterBase`. Additionally:

- Only use CLI flags you verified exist (`hasFlag()` probing). Do not invent
  `--json-task` style flags.
- Prefer official interfaces: plugin/API > RPC > subprocess > TUI scraping.
- If a capability genuinely does not exist upstream, declare the limitation.

## Changing the protocol

`packages/protocol` is the contract. Any change to states, transitions or the
envelope needs:

- an update to `docs/protocol/state-machine.md`,
- protocol tests in `tests/protocol.test.mjs`,
- an ADR if the change is architectural.

## Commit style

Conventional commits, small and meaningful:

```text
docs: define Agent2LLM architecture and C2C reuse map
feat(protocol): add A2L protocol and state machine
feat(harness): add WorkBuddy adapter
test: add adapter contract and security suites
```

No "initial commit" containing the universe.

## Attribution

If you adapt upstream code, keep its license header and add a row to
`docs/C2C_REUSE_MAP.md` and an entry in `THIRD_PARTY_NOTICES.md`.
