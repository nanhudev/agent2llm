# A2L protocol (`a2l/1`)

A2L is the abstract control language between a Brain and a Harness. It carries
**state, never content**. Workspace data travels over the read-only MCP data
plane.

## Envelope

```json
{
  "protocol": "a2l/1",
  "sessionId": "a2ls_...",
  "taskId": "a2lt_...",
  "iteration": 3,
  "type": "PLAN",
  "workspaceId": "a2lw_...",
  "sender": { "role": "brain", "adapter": "chatgpt-web" },
  "timestamp": "2026-09-16T00:00:00.000Z",
  "payload": {},
  "refs": []
}
```

Validated at runtime with Zod. Messages that fail validation are rejected, not
coerced.

## Identity rules

Checked on every message, before any state change:

| Rule | Why |
| --- | --- |
| `sessionId` must match | Sessions must not cross-talk |
| `taskId` must match | A stale task cannot steer a new one |
| `workspaceId` must match | Cross-workspace reads fail closed |
| `iteration` must not go backwards | Prevents replay of an old decision |
| `type` must be a known state | Unknown verbs are never guessed |
| Only `core` may enter `DISPATCHED` / `EXECUTING` | A Brain cannot claim to have executed |
| After `DONE`, only `HANDOFF` | A finished task cannot mutate the workspace |

## Size budget

| Channel | Budget |
| --- | --- |
| Control plane, general | `< 4 KB` |
| Control plane, web Brain | `< 1 KB` (target) |

The control plane carries state, ids, counts, summaries, intent and next
action. It must never carry file bodies, large diffs, full logs or archives.

## Web wire format

Web Brains reply in prose. The control block is a fenced text block:

```text
[A2L]
PROTOCOL: a2l/1
SESSION: a2ls_...
TASK: a2lt_...
ITERATION: 0
STATE: PLAN
WORKSPACE: a2lw_...
FROM: brain/chatgpt-web
TIME: 2026-09-16T00:00:01.000Z

GOAL:
Add dark mode
RATIONALE:
The app hardcodes light colours.
ACTIONS:
- Add a theme provider
- Toggle the class on <html>
TESTS:
npm test
SUCCESS_CRITERIA:
Toggle switches the palette and tests pass.
```

Parsing (`packages/protocol/src/wire.ts`) tolerates surrounding prose, is
strict about the header block, and resolves union payload fields by trying each
declared option in order.

## C2C migration

`packages/protocol/src/c2c.ts` maps C2C states onto A2L:

```text
C2C INIT     -> A2L INIT
C2C PLAN     -> A2L PLAN
C2C EXECUTED -> A2L EXECUTED
C2C DONE     -> A2L DONE
C2C HANDOFF  -> A2L HANDOFF
```

Unknown states map to `null`, never to a guess.
