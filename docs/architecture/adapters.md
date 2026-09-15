# Adapter architecture

Two interfaces, one contract suite, zero brand knowledge in Core.

## The two interfaces

```ts
interface BrainAdapter {
  metadata(): AdapterMetadata;          // id, name, version, role: "brain"
  detect(): Promise<DetectionResult>;
  capabilities(): Promise<CapabilityManifest>;
  setup(ctx: SetupContext): Promise<SetupResult>;
  createSession(ctx: BrainSessionContext): Promise<BrainSession>;
  attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession>;
  sendControl(session, message): Promise<void>;
  awaitControl(session, options?): Promise<ControlMessage>;
  verifyWorkspace(session, workspace): Promise<VerificationResult>;
  close(session): Promise<void>;
}

interface HarnessAdapter {
  metadata(): AdapterMetadata;          // role: "harness"
  detect(): Promise<DetectionResult>;
  capabilities(): Promise<CapabilityManifest>;
  setup(ctx: SetupContext): Promise<SetupResult>;
  createSession(ctx: HarnessSessionContext): Promise<HarnessSession>;
  attachSession(checkpoint: HarnessCheckpoint): Promise<HarnessSession>;
  execute(session, task): Promise<ExecutionHandle>;
  events(handle): AsyncIterable<HarnessEvent>;
  cancel(handle): Promise<void>;
  close(session): Promise<void>;
}
```

Behaviour-specific methods are allowed **only** behind declared capabilities.

## Capability manifest

A capability is not a boolean. Each entry records support level, transport,
experimental flags, limitations and notes. Keys include:

```text
session.create      session.attach    session.resume    session.cancel
workspace.read      workspace.write
shell.execute
git.inspect         git.modify
task.execute
stream.events
conversation.send   conversation.receive
plan.generate       review.perform
mcp.remote          browser.control
structuredOutput    interactiveApprovals
supportsHeadless
```

If a capability does not exist, it is declared missing. Adapters never fake it
(section "No fake adapters" below).

## Adapter status vocabulary

| Status | Meaning |
| --- | --- |
| `implemented` | Code exists and passes the contract suite |
| `detected` | The binary / app was found on this machine |
| `configured` | Credentials or pairing are present |
| `authenticated` | A live session was established at least once |
| `verified` | End-to-end behaviour observed on this machine |
| `experimental` | Works, but the upstream surface is unstable |
| `unsupported` | Upstream has no such capability |
| `unavailable` | Present but not usable right now |

`implemented: true, detected: false, verified: false` is a valid and common
state (for example Cursor on a machine without Cursor). README must never
render that as "fully supported".

## No fake adapters

```ts
async execute() { return { success: true }; }   // forbidden
```

Real adapters must actually invoke the product or fail with a typed error.
Mocks exist only under `packages/brains/mock` and `packages/harnesses/mock` and
are never registered as real adapters by default.

## External adapters

`packages/adapter-sdk/src/loader.ts` loads `@agent2llm/harness-foo` /
`@agent2llm/brain-bar` from `node_modules` or from `adapterPackages` in the
machine config. The manifest declares `apiVersion`; a mismatch produces a clear
error naming expected and found versions rather than an obscure crash.

## Contract suite

Every adapter runs `tests/adapter-contract.test.mjs`:

- metadata valid
- capability manifest valid
- detect deterministic
- setup failure is a typed error
- session lifecycle valid
- cancel is safe
- close is idempotent
- events conform to the schema

The suite needs no third-party product installed.
