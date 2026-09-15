# Workspace broker

One local broker, many registered workspaces.

```text
agent2llm broker (single local daemon)
   ├── a2lw_8f2c…  → project-a   (ChatGPT × DSH)
   ├── a2lw_19ab…  → project-b   (Claude  × Cursor)
   └── a2lw_77de…  → scratch     (API     × WorkBuddy)
```

## What the Brain sees

| Visible | Never visible |
| --- | --- |
| Opaque workspace id (`a2lw_…`) | Absolute filesystem path |
| Display name | Host username / home layout |
| Project type, languages, frameworks | Sibling directories outside the root |
| Git identity (branch, commit, dirty) | Other registered workspaces |

## Binding

A workspace is bound once, by real path:

1. Resolve the requested path.
2. `fs.realpath` it, following symlinks and junctions.
3. Store the canonical root.
4. Every later access resolves then checks containment against that root.

## Escape defences

| Attack | Defence |
| --- | --- |
| `../` traversal | Canonicalise, then require the result to be inside the root |
| Absolute path | Same containment check |
| File symlink escape | `realpath` before containment |
| Directory symlink escape | Same — the whole path is canonicalised, not just the last segment |
| Junction (Windows) | `realpath` resolves junctions |
| Case-insensitive bypass | Compare canonical (real) paths, not raw strings |
| Nonexistent ancestor | Resolved before the containment decision, not after |

## Sensitive files

Denied by default:

```text
.env, .env.*        private keys        SSH credentials
cloud credentials   token files         auth databases
browser profiles
```

`.env.example` stays readable, because it is documentation.

`.agent2llmignore` is honoured; `.c2cignore` keeps working for users migrating
from C2C. `node_modules` and comparable noise directories are always excluded
from listings and search.

## Non-git workspaces

Git is the preferred change source, but not a requirement. Without a repo,
`packages/workspace/src/snapshot.ts` keeps a content-hash snapshot so
`changed_files` still returns real answers.

## Session scoping

Each session binds one workspace. Tokens are scoped to
installation + workspace + session. A session for workspace A cannot read
workspace B, even with a valid token.
