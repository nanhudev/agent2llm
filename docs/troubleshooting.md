# Troubleshooting

Start here:

```bash
agent2llm doctor
```

`doctor` reports `PASS` / `WARN` / `FAIL` / `SKIP` / `UNVERIFIED` and says, for
each failure, what broke, why, and whether an automatic repair exists.

---

## "No harness detected"

`agent2llm detect` looks in PATH, common install locations, application bundles,
Windows installed-app metadata and package-manager metadata. It does **not**
scan the whole disk.

Fixes:

- Install the harness, or add it to PATH.
- Run `agent2llm detect --json` to see exactly what was probed.
- An undetected harness is not an error: the adapter stays
  `implemented / detected:false`.

## "This combination cannot run brain-hands because …"

The compatibility engine refused the pairing on capabilities, not on brand.
Read the message: it names the adapter and the missing capability.

```text
This combination cannot run brain-hands because
cursor adapter currently lacks attach-session capability.
```

Fix by choosing a workflow that does not need that capability (for example
`planner-only`), or by using an adapter that has it.

## Brain never replies

- Is a login, CAPTCHA or 2FA pending? Agent2LLM emits `USER_ACTION_REQUIRED`
  one action at a time — complete it in the browser window.
- Run with `--verbose` to see transport-level detail.
- Try `--brain mock-brain` to confirm the orchestrator itself is healthy.

## Brain says it reviewed, but the diff looks unchanged

That is the system working: review is evidence-based. Check
`changed_files` and `git_diff` — if the Harness reported success without
changing anything, `REVISE` is the correct outcome.

## Control message rejected / protocol violation

The machine validates session, task, workspace, iteration monotonicity and
legal transitions. Common causes:

- Resuming with a `--session` from a different workspace.
- A stale task id.
- An adapter emitting a state it is not allowed to enter (only `core` may enter
  `DISPATCHED` / `EXECUTING`).
- A Brain going backwards in `iteration`.

## Port already in use / stale bridge

```bash
agent2llm session list
agent2llm session stop <id>
```

The daemon performs stale-pid cleanup and port recovery on start; if a bridge
still will not come up, `agent2llm doctor` will show the health observation.

## OAuth / pairing problems

- Pairing codes are one-time, TTL-limited and attempt-limited by design. Request
  a new one rather than retrying an old code.
- Authentication and CAPTCHA failures are **never** retried automatically —
  retry-storming an auth endpoint is not a feature.
- `agent2llm unpair` then `agent2llm pair` resets the relationship.

## Tunnel problems

`agent2llm doctor` reports the tunnel provider. If `cloudflared` is missing or
blocked, run with a local-only configuration (`--tunnel none`) where the Brain
and the bridge are on the same machine.

## Sensitive file refused

`.env`, private keys, SSH credentials, cloud credentials, token files, auth
databases and browser profiles are denied by default. `.env.example` is allowed.
Narrow the request or add an ignore rule — do not expect the deny list to be
disabled.

## Logs

```bash
agent2llm logs
```

Tokens, pairing codes, API keys, cookies and authorization headers are redacted
before anything is written.
