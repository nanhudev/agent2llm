# Workflow presets

Two families. **Relay** is conversation-centric: one Brain thread across many
runs, and the Harness is sent one step at a time. The presets below are the
older, plan-centric family, where each run produces a plan the Brain reviews.
They all still work, unchanged.

## `relay`

One Brain conversation, many goals. The Harness receives a next action and its
acceptance criteria, never the run's goal. See `relay.md`.

```text
GOAL ──► BRAIN (next step) ──► HARNESS (execute one) ──► EVIDENCE ──► BRAIN …
                     ▲                                                  │
                     └──── the conversation survives between runs ◄──────┘
```

## `brain-hands` (default)

Brain plans and reviews; Harness executes. See `brain-hands.md`.

## `peer`

Both sides propose and challenge; only the Harness mutates. See `peer.md`.

## `planner-only`

The Brain produces a plan and stops. The Harness executes once and the run
ends — **no Brain review**.

```text
GOAL ──► BRAIN (plan) ──► HARNESS (execute once) ──► end
```

Use when you want a plan from a strong model but do not want review latency.

## `review-only`

The Harness works autonomously; the Brain reviews at the end.

```text
GOAL ──► HARNESS (autonomous) ──► BRAIN (review) ──► DONE | REVISE
```

Use when the task is well understood and you mainly want an independent check.

## `harness-autonomous`

The Brain is not called at all. Agent2LLM degrades into a unified harness
launcher.

```text
GOAL ──► HARNESS ──► end
```

Useful for CI-style execution and for A/B comparing harnesses.

## `custom`

Defined by workflow config: which side acts at each state, and what the
capability requirements are. No code change required.

## Choosing

| Goal | Preset |
| --- | --- |
| Highest-confidence result | `brain-hands` |
| Brain lacks local context | `peer` |
| Just want a plan | `planner-only` |
| Task is routine, want a check | `review-only` |
| No Brain available | `harness-autonomous` |
