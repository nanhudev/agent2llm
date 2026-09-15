# Harness adapter: DeepSeek Harness (DSH)

- **Id:** `dsh`
- **Role:** `harness`
- **Local detection:** **detected** — `dsh 0.1.2-rc.1` on this machine

## Integration path, in priority order

1. **Native DSH plugin / service / event integration** (preferred).
2. Official RPC / API.
3. Subprocess transport.
4. Terminal UI parsing — last resort, never the primary path.

DSH is a developer preview and changes quickly, so the adapter performs
**capability probing rather than version pinning**: it inspects the installed
binary, its profiles and its help output, then declares what actually exists.

## What is probed

| Probe | Meaning |
| --- | --- |
| binary presence and version | `dsh --version` |
| `headless` profile | one-shot non-interactive execution is available |
| `resume` support | `session.attach` / `session.resume` |
| profile metadata under the DSH home | which models/transports are configured |

Probed facts feed the capability manifest directly. If `headless` is absent, the
adapter reports:
`No 'headless' profile detected: non-interactive one-shot execution is unavailable.`

## Capabilities (when detected)

```text
session.create    task.execute       workspace.read    workspace.write
shell.execute     git.inspect        git.modify        stream.events
structuredOutput  supportsHeadless
session.attach / session.resume  — only when resume is actually available
```

## Compatibility layer

`DshCompatibilityLayer` exists because DSH internals are unstable. It maps
version/capability facts to behaviour, and degrades gracefully instead of
assuming an internal API will still be there next release.

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Binary detected | **yes** (`0.1.2-rc.1`) |
| Real end-to-end task | **not run** — out of scope for this delivery (would consume model quota) |
