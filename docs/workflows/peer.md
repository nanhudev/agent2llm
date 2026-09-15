# Workflow: peer

Brain and Harness may both **propose, challenge, request clarification and
suggest revisions**. Workspace mutation still belongs to the Harness alone.

```text
USER GOAL
   │
   ├──► BRAIN      (proposal)
   ├──► HARNESS    (counter-proposal)
   │
   ▼
converge on a plan
   │
   ▼
HARNESS executes  ──►  BRAIN reviews  ──►  DONE | REVISE
```

## Difference from brain-hands

| Aspect | brain-hands | peer |
| --- | --- | --- |
| Planning authority | Brain only | Both propose, Brain arbitrates |
| Challenge allowed from Harness | no | yes |
| Who mutates | Harness | Harness |
| Review | Brain | Brain |

Peer is useful when the Harness has strong local context (build system quirks,
failing test history) that the Brain cannot see through file reads alone.

## Capability requirements

As brain-hands, plus Harness `plan.generate` (it must be able to propose).

## Note

Peer **never** grants the Harness permission to change the permission model. It
can disagree about *what* to do, not about *who is allowed to write*.
