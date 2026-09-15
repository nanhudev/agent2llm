# Workflow: brain-hands

The default. **Brain decides, Hands act.**

```text
USER GOAL
   │
   ▼
BRAIN — inspect through MCP, reason, plan
   │
   ▼
HARNESS — edit, shell, test
   │
   ▼
BRAIN — independent review of the real workspace
   │
 ┌─┴──────────────┐
DONE            REVISE
                  │
                  ▼
               HARNESS (next iteration)
```

## Rules

- The Brain reviews **evidence**, not claims: `git_status`, `git_diff`,
  `changed_files`, `test_status`, `execution_summary`, `execution_output`.
- Only the Harness mutates the workspace.
- The Brain cannot obtain shell, write or git-modify at any point.
- Iterations are bounded; exceeding the bound ends in `BLOCKED`, never in a
  silent success.

## Capability requirements

Brain: `session.create`, `conversation.send`, `conversation.receive`,
`plan.generate`, `review.perform`, `workspace.read`.

Harness: `session.create`, `task.execute`, `workspace.write`.

If a requirement is missing, the compatibility engine refuses the combination
with a specific message — it does not start and hope.

## When to use

Almost always. This is the mode that makes "your best model thinks, your
favourite agent builds" true.
