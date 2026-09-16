#!/usr/bin/env node
/**
 * Enable the GitHub Actions workflow.
 *
 * The workflow ships at `.github/ci/github-actions.yml` instead of
 * `.github/workflows/ci.yml` because GitHub treats `.github/workflows/**` as a
 * protected path: any push that creates or updates a file there is rejected
 * unless the credential carries the `workflow` scope. A `repo`-scoped token
 * alone is refused with:
 *
 *   refusing to allow a Personal Access Token to create or update workflow
 *
 * This script copies the shipped config into the real workflow directory.
 * The commit it produces then needs a credential with the `workflow` scope,
 * which is exactly what the script tells you at the end.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.github', 'ci', 'github-actions.yml');
const targetDir = join(root, '.github', 'workflows');
const target = join(targetDir, 'ci.yml');

if (!existsSync(source)) {
  console.error('enable-ci: cannot find', source);
  process.exit(1);
}

if (existsSync(target)) {
  const same = readFileSync(target, 'utf8') === readFileSync(source, 'utf8');
  console.log(same ? 'enable-ci: CI workflow is already enabled.' : 'enable-ci: overwriting the existing workflow.');
}

mkdirSync(targetDir, { recursive: true });
writeFileSync(target, readFileSync(source));

console.log('enable-ci: wrote', target);
console.log('');
console.log('Next: commit it with a credential that has the `workflow` scope.');
console.log('  git add .github/workflows/ci.yml');
console.log('  git commit -m "ci: enable GitHub Actions workflow"');
console.log('');
console.log('Without the `workflow` scope that push is rejected by GitHub.');
console.log('Create a token at: https://github.com/settings/tokens (tick `repo` and `workflow`).');
