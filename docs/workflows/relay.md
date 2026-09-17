# Relay Mode

One Brain conversation, many goals. The Brain keeps the thread; the Harness does
one step at a time.

```text
RUN 1                                  RUN 2 (days later)
goal ─► BRAIN ─► NEXT_ACTION ─► HARNESS goal ─► BRAIN ─► NEXT_ACTION ─► HARNESS
          ▲                        │                  ▲                 │
          └── EVIDENCE ◄───────────┘                  └── EVIDENCE ◄────┘
              (read from git)                            (same conversation)
```

The conversation is the only thing that survives between runs, and that is the
point: a plan built over three weeks lives in a thread, not in a file the user
has to remember to re-attach.

## Why not just hand the Harness a goal

Because a Harness handed a goal does three things you did not ask for:

1. **Re-derives the plan** the Brain already made — duplicated reasoning, and
   the second derivation can differ from the first.
2. **Reads the repository** to build context the Brain already has.
3. **Writes a document** describing its work, which is a file nobody requested
   and one more thing to review.

Relay inverts the ownership so none of that is necessary:

| | Owner |
| --- | --- |
| The conversation | the **Brain** — held by the Pair, survives runs |
| The workspace | the **Harness** — every dispatch is one step |
| The evidence | **Agent2LLM** — read from git, not accepted from the Harness |

## The dispatch

A Relay dispatch is execution-only. It carries a next action and the criteria
the step will be judged by — never the run's goal:

```text
EXECUTION-ONLY MODE
NEXT ACTION
  Add a slugify(text) export to src/slugify.js.
ACCEPTANCE
  - src/slugify.js exists
  - 'Hello World' becomes 'hello-world'
```

`tests/relay.test.mjs` asserts the negative directly: the rendered brief must
not contain the goal string nor any plan step the Brain did not restate. A brief
that leaks the goal is a brief that invites re-planning.

## The evidence

After every dispatch, Agent2LLM reads the repository itself and forms a verdict
before talking to the Brain:

| Verdict | Meaning |
| --- | --- |
| `corroborated` | git shows what the Harness claimed, or a step with nothing to write |
| `unverified` | no repository to read — the claim could not be checked |
| `contradicted` | the Harness claimed files and the working tree is clean |

The Brain is sent a compact form: ids, exit status, changed files, verdict. The
full record stays on disk. A Brain can ask for one file's real diff with
`SHOW_DIFF <path>`, which is answered from the repository and never from the
Harness — bounded, so a Brain that keeps asking becomes a verdict rather than an
endless polite conversation.

## The run status

The Brain's `DONE` is a claim about its own reasoning. The run's status is a
record of what was there:

| Observed | Status |
| --- | --- |
| Evidence `contradicted` | `blocked` |
| Every dispatch failed | `blocked`, quoting the Harness's own error |
| Some dispatch succeeded, Brain says done | `done` |
| Brain says done and nothing was dispatched | `done`, with `0 execution(s)` in the metrics |

The second row was found by running against real Codex, not by reasoning about
it: both dispatches came back `403 Forbidden` and the run still said `done` and
exited 0, because a scripted Brain had nothing better to say. A status a user
cannot trust is worse than no status.

## Commands

```bash
agent2llm pair create --brain chatgpt-web --harness codex
agent2llm pair list
agent2llm pair show                # the conversation pointer and the stored context
agent2llm pair remove <id>

agent2llm run "goal"               # the active pair
agent2llm run "goal" --pair <id>
agent2llm run "goal" --relay --brain chatgpt-web --harness codex
```

**Relay is opt-in in both directions.** `--brain X --harness Y` without
`--relay` still means brain-hands, unchanged, because a user who typed those
flags is asking for the other promise. `--relay` forces it; `--pair` implies it.

## The context

In Relay the Harness owns the context, so you are not asked for a folder. The
pair records where the Harness says it is working and uses that. Where an
adapter cannot answer, the earlier sources are tried in order:

1. **`--workspace`**, if you typed it. It wins outright, in every mode — the
   flag is an override, not an answer to a question the Harness already
   answered. When the two disagree the CLI names the folder it ignored.
2. **The Harness's own report**, cached on the pair, refreshed on every run.
3. **The pair's stored context**, from a previous run.
4. Nothing — and then the run **refuses**. It will not fall back to the process
   working directory, because a run that edits the wrong repository looks
   exactly like one that worked.

## Honest metrics

Three units, never mixed. See the "Measured, not claimed" section of the
[README](../../README.md) for the full rule; in short: provider tokens where a
provider reports them, `unavailable` with a reason where it does not, and
byte-derived *estimated text tokens* labelled as estimates.

## What has and has not been proven

- **Proven by tests.** Relay routing, the execution-only brief, conversation
  reuse across runs, git-verified evidence, `SHOW_DIFF`, the contract refusals,
  and every status rule above. `tests/relay.test.mjs`, `tests/run-routing.test.mjs`.
- **Exercised end to end.** `npm run e2e:relay` builds a scratch repository,
  pairs the mock Brain with a **real** harness, and runs the real CLI against
  it. On the machine this was developed on it reaches Codex, dispatches twice,
  collects evidence, writes a run record, and reports `blocked` with Codex's own
  `403 Forbidden` (quota). The four failing checks are all downstream of that.
- **Not proven.** No Relay run has completed against a real harness, and no real
  (non-mock) Brain has driven one.
