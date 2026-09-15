# Brain adapter: API provider

- **Id:** `api`
- **Role:** `brain`
- **Local detection:** depends on the provider credential env var
  (`OPENAI_API_KEY` for the default OpenAI-compatible provider)

## Position

The API Brain is a supplement, not the product. Agent2LLM exists to decouple a
*thinking client* from a *harness*; an API endpoint is the fallback for when no
web client is available.

## Workspace access

An inference endpoint has no MCP client of its own. Agent2LLM solves this by
handing the Brain the **same read-only tool surface** in-process
(`createInProcessDataPlane` in `packages/mcp`), which the Brain calls through
provider tool calling.

```text
API Brain
   │ tool_calls (workspace_info, read_file, git_diff, …)
   ▼
In-process read-only data plane
   │
   ▼
Workspace (same containment, deny list and ignore rules as MCP)
```

- If a data plane is attached **and** the provider supports tool calling, the
  Brain declares `workspace.read` and can review independently.
- Otherwise it declares **no** workspace access. It does not pretend.

Unknown or failing tool calls return an error string to the model rather than
aborting the run, so a bad model guess cannot break the loop.

## Providers

| Provider | Tool calling |
| --- | --- |
| `openai-compatible` | yes |
| `anthropic` | no — declared honestly, not faked |

The provider interface is deliberately not OpenAI-shaped: "send a system prompt
plus turns, get text back". Provider wiring lives in `providers.ts` and nowhere
else.

## Capabilities

```text
session.create  session.attach  session.resume  session.cancel
conversation.send  conversation.receive
plan.generate   review.perform  structuredOutput  supportsHeadless
workspace.read  — only when a data plane is attached and the provider supports tools
```

## Verification status

| Item | State |
| --- | --- |
| Implementation | complete |
| Contract suite | passing |
| Real E2E | **unverified** — requires an API key and would incur cost |
