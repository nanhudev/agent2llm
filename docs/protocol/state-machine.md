# A2L state machine

The machine is finite and fully enumerated in
`packages/protocol/src/states.ts`. Anything not listed is rejected.

## States

| State | Who speaks next | Meaning |
| --- | --- | --- |
| `BOOTSTRAP` | core | Local runtime coming up |
| `READY` | core | Adapters resolved, compatible, not started |
| `INIT` | brain | Goal delivered to the Brain |
| `INSPECTING` | brain | Brain is reading the workspace through MCP |
| `PLAN` | core | Brain returned a finite plan |
| `DISPATCHED` | harness | Core handed the plan to the Harness |
| `EXECUTING` | harness | Harness is mutating the workspace |
| `EXECUTED` | brain | Execution finished; evidence recorded |
| `REVIEWING` | brain | Brain is inspecting the real changes |
| `REVISE` | core | Brain rejected the result with required changes |
| `DONE` | — | Brain verified completion |
| `BLOCKED` | — | Needs something the system cannot supply |
| `ERROR` | core | Recoverable or terminal fault |
| `HANDOFF` | brain | Conversation lost; resume with a HANDOFF brief |

## Transitions

```text
BOOTSTRAP → READY | ERROR
READY     → INIT | HANDOFF | ERROR
INIT      → INSPECTING | PLAN | BLOCKED | ERROR
INSPECTING→ PLAN | BLOCKED | ERROR
PLAN      → DISPATCHED | BLOCKED | ERROR
DISPATCHED→ EXECUTING | EXECUTED | ERROR
EXECUTING → EXECUTED | ERROR | BLOCKED
EXECUTED  → REVIEWING | HANDOFF | ERROR
REVIEWING → DONE | REVISE | BLOCKED | ERROR | HANDOFF
REVISE    → PLAN | DISPATCHED | BLOCKED | ERROR
DONE      → HANDOFF
BLOCKED   → HANDOFF | INIT
ERROR     → INIT | HANDOFF | READY | DONE | BLOCKED
HANDOFF   → INIT | INSPECTING | PLAN | REVIEWING | EXECUTED | ERROR
```

## Invariants

1. **`DONE` cannot mutate.** After `DONE`, the only legal transition is
   `HANDOFF`. A completed task may not be silently reopened into `EXECUTING`.
2. **Mutation states belong to Core.** `DISPATCHED` and `EXECUTING` may only be
   entered by a message whose `sender.role === "core"`. A Brain cannot claim to
   have executed work.
3. **Iteration is monotonic.** `iteration` may never decrease.
4. **Identity is checked before effect.** Session, task and workspace are
   validated before the transition, so a mismatched message changes nothing.
5. **Terminal states are `DONE` and `BLOCKED`.** Only `HANDOFF` (and, for
   `BLOCKED`, `INIT`) may leave them.

## HANDOFF

When the Brain conversation is lost (cleared context, expired session, new
machine), Agent2LLM opens a fresh conversation and sends `HANDOFF`.
A HANDOFF carries:

```text
ORIGINAL_GOAL
PROGRESS
CURRENT_STATE
KNOWN_ISSUES
NEXT_EXPECTED_STEP
```

It must **not** carry full logs, whole files or massive diffs. The new Brain
re-reads the workspace through MCP.
