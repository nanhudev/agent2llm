# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report privately through GitHub's private vulnerability reporting on this
repository. Include:

- what the issue is,
- how to reproduce it,
- the affected package and version,
- impact as you see it.

You should get an acknowledgement within a few days.

## Scope

In scope:

- Workspace containment bypass (`../`, symlink, junction, absolute path).
- Sensitive-file reads that should have been denied.
- Token / pairing-code / refresh-token handling.
- Credential leakage into logs.
- A Brain obtaining write, shell or git-modify capability by any route.
- Capability forgery by an adapter.

Out of scope:

- Compromise of the machine before Agent2LLM runs.
- A malicious third-party harness the user chose to install.
- Provider-side issues in ChatGPT, Claude or any model API.

## Design guarantees worth knowing before you report

- **The Brain has no mutation tools.** `write_file`, `shell`, `git_commit`,
  `install_package` and friends do not exist in the Brain-facing MCP server, so
  a scope bug cannot enable one.
- **Permissions never come from model text.** Workspace content is untrusted
  data and cannot grant capability.
- **Mutation states belong to Core.** A Brain cannot claim `EXECUTING`.
- **Authentication failures are not retried.** No retry-storming of auth or
  CAPTCHA endpoints.

See [`docs/security/threat-model.md`](docs/security/threat-model.md).
