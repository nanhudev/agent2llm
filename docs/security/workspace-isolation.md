# Workspace isolation

This document describes the boundary that keeps a Brain inside one directory.

## Binding model

```text
requested path ──► resolve ──► fs.realpath ──► canonical root ──► all later checks
```

The canonical root is captured once at binding time. Every read, listing and
search resolves the requested path fully, then requires the result to be inside
that root.

## Rejections, by example

Given a workspace bound at `/work/project`:

| Request | Result |
| --- | --- |
| `src/index.ts` | allowed |
| `src/../src/util.ts` | allowed — canonicalises inside the root |
| `../outside/secret.txt` | rejected |
| `/etc/passwd` | rejected |
| `link.txt` → `/tmp/secret.txt` | rejected (file symlink) |
| `outside-dir/secret.txt` where `outside-dir` → `/tmp` | rejected (dir symlink) |
| `.env` | rejected (sensitive) |
| `.env.local` | rejected (sensitive) |
| `.env.example` | allowed |
| `config/credentials.json` | rejected (sensitive) |
| `keys/id_rsa` | rejected (sensitive) |
| `node_modules/dep/index.js` | hidden by default |

## Sensitive-file policy

Denied classes: dotenv files, private keys, SSH credentials, cloud
credentials, token files, auth databases, browser profiles.

`.env.example` is explicitly allowed so that documented configuration stays
readable.

## Ignore files

- `.agent2llmignore` — first-class.
- `.c2cignore` — still honoured, for users migrating from C2C.
- Noise directories (`node_modules`, build output, VCS metadata) are always
  excluded from listings and search.

## Opaque identifiers

The Brain never receives a filesystem path. Workspaces are referenced by
`a2lw_…` ids, and the workspace root is presented as the alias `workspace:/`.
A leaked id therefore leaks no directory layout, no username and no host
structure.

## Session and token scoping

Tokens are scoped to installation + workspace + session. A session bound to
workspace A cannot read workspace B even with a valid token, because the
workspace id is validated on every request *and* on every control message.

## Non-git workspaces

Git is preferred but not required. `packages/workspace/src/snapshot.ts`
maintains a content-hash snapshot so `changed_files` still answers honestly when
there is no repository.

## Test coverage

`tests/workspace-security.test.mjs` covers traversal, absolute paths, file and
directory symlinks, junctions, the sensitive-file deny list, and both ignore
file formats.
