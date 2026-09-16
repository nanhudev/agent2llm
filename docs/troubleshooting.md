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

## "requires authentication"

Agent2LLM does not read another product's credentials, so for most adapters
the sign-in state is **unknown**, not false. Unknown is reported as a warning
and the run proceeds — the truth arrives when the page opens.

A refusal means an adapter actually measured the state. Check what it says:

```text
Brain adapter 'api' requires authentication (OPENAI_API_KEY ...).
```

Then either satisfy it, or override it when you know the session exists:

```bash
agent2llm run --brain chatgpt-web --harness workbuddy --ignore-auth --goal "..."
```

## "No DevTools endpoint answered"

`doctor` reports this when it found no window to attach to. The repair line
names which place it searched, and the cause differs per line:

- **"Nothing answered at …"** — you passed `--endpoint` (or set
  `AGENT2LLM_ATTACH_ENDPOINT`) and that port is dead. Check the window is
  still open and the port matches.
- **"A window profile names …, but nothing answered there"** — a
  `DevToolsActivePort` file is stale: Chromium does not always rewrite or
  remove it, so it can name a port from a run that has exited. Restart that
  app.
- **"Nothing answered on 9222, 9223, 9229"** — no window was started with a
  debug port, or it listens elsewhere. Start one, or name the port:

```bash
curl -s http://127.0.0.1:<port>/json/version          # confirm it answers
agent2llm run --brain chatgpt-web --harness <id> --endpoint http://127.0.0.1:<port> --goal "..."
export AGENT2LLM_ATTACH_PORTS=<port>                  # or sweep it every time
```

A port of `9222` that "answers" with a `502` and a proxy banner is not a
browser: something else on the machine is listening there.

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
