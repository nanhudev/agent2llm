# Prior art: codex-with-chatgpt (C2C)

Upstream: https://github.com/XiaoDuoYa/codex-with-chatgpt — MIT, v0.1.3.

## What C2C proved

C2C demonstrated that a subscription web client (ChatGPT) can act as the
planning and review brain for a local coding agent (Codex) without an API key,
without a reverse proxy, and without uploading the repository.

Its lifecycle:

```text
Codex ──tiny control messages──► ChatGPT Web
ChatGPT Web ──read-only MCP──► C2C Bridge ──► Workspace
```

## The one idea Agent2LLM must keep

**Control plane ≠ data plane.**

- **Control plane** carries state: `INIT`, `PLAN`, `EXECUTING`, `EXECUTED`,
  `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`. Small — under 4 KB, ideally
  under 1 KB for web brains.
- **Data plane** is a read-only MCP server. The Brain pulls what it needs:
  `workspace_info`, `list_directory`, `read_file`, `search_workspace`,
  `git_status`, `git_diff`, `test_status`, `execution_summary`,
  `execution_output`.

The consequence — and the reason this matters — is that the Brain reviews the
**real** workspace rather than the Harness's description of it. A Harness
saying "tests pass" is a claim; `git_diff` is evidence.

## What Agent2LLM changes

| C2C | Agent2LLM | Reason |
| --- | --- | --- |
| One brain (ChatGPT) × one harness (Codex) | N brains × M harnesses | The value is composability, not one pairing |
| `C2C` control verbs | `A2L` (`a2l/1`) protocol | Different protocol, documented state machine, typed envelope |
| One bridge = one workspace | Local broker + workspace registry | Multiple concurrent projects |
| Browser control lives in the Codex flow | `BrowserTransport` in Core | Not every harness can drive a browser |
| Implicit review state | Explicit `INSPECTING` / `REVIEWING` | Distinguishes "thinking" from "silent" |
| Codex-specific types | Role-based types | `Role`, not brand, is the domain model |

## What Agent2LLM deliberately does not do

- No reverse proxy of ChatGPT or Claude.
- No private-API interception, no cookie or session-token extraction.
- No internal-endpoint emulation.
- No browser profile export or upload.

Official website UI automation, official login pages and official MCP connector
configuration are permitted. Bypassing CAPTCHA, 2FA or security confirmations
is not — those surface as `USER_ACTION_REQUIRED`.

See also: `docs/C2C_REUSE_MAP.md`, `THIRD_PARTY_NOTICES.md`.
