#!/usr/bin/env node
/**
 * Publish the packed tarball as a GitHub Release.
 *
 * GitHub is the distribution channel instead of the npm registry: the
 * registry requires 2FA on publish, which puts a human with an authenticator
 * in the loop on every version. A release tag plus an attached tarball needs
 * only a token with `repo`, and it works the same from CI later.
 *
 * Uploads to the release's `uploads.github.com` endpoint, not the asset API's
 * JSON endpoint — the two look similar and only the first accepts bytes.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const OWNER = "nanhudev";
const REPO = "agent2llm";
const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GH_TOKEN is not set.");
  process.exit(1);
}

const root = process.cwd();
const rootPkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = rootPkg.version;
const tag = `v${version}`;
const tgz = path.join(root, `${rootPkg.name}-${version}.tgz`);

await stat(tgz).catch(() => {
  console.error(`missing ${path.basename(tgz)} — run \`npm run pack\` first.`);
  process.exit(1);
});

const headers = {
  authorization: `token ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "agent2llm-release",
  "content-type": "application/json",
};

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const detail = typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed).slice(0, 300);
    throw new Error(`${method} ${url} -> ${response.status} ${detail}`);
  }
  return parsed;
}

/**
 * A release needs its tag to exist. Tagging locally and pushing is the honest
 * way to do it: the release then points at a commit that is actually in the
 * repository, not one the API invented.
 */
const notes = `## Install

\`\`\`bash
npm install -g https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${rootPkg.name}-${version}.tgz
\`\`\`

Or without installing:

\`\`\`bash
npx https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${rootPkg.name}-${version}.tgz doctor
\`\`\`

Requires Node.js >= 20. Verify the install end to end with no login and no keys:

\`\`\`bash
agent2llm doctor
agent2llm run --brain mock-brain --harness mock-harness --goal smoke
\`\`\`

## What is in it

- **Brain / Harness decoupling.** Your reasoning client plans and reviews;
  a coding agent executes. Capability-checked, not convention: no harness
  can declare \`plan.generate\` or \`review.perform\`.
- **\`agent2llm report\`** — what the Brain's tokens actually cost, per session
  and per phase. The harness side is 0 brain tokens by construction.
- **Window attach** — drives a Chromium window (including a desktop build)
  that is already open and signed in, over the DevTools protocol.
- **\`AGENTS.md\`** — a runbook so an AI agent can install this correctly.

Full documentation: https://github.com/${OWNER}/${REPO}#readme
`;

async function main() {
  console.log(`repository ${OWNER}/${REPO}`);
  console.log(`release    ${tag}`);

  // Reuse the release if it exists, so re-running is safe.
  let release = null;
  try {
    release = await api("GET", `${API}/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
    console.log(`  existing release found (id ${release.id})`);
  } catch {
    release = await api("POST", `${API}/repos/${OWNER}/${REPO}/releases`, {
      tag_name: tag,
      name: `${rootPkg.name} ${version}`,
      body: notes,
      draft: false,
      prerelease: version.includes("-"),
    });
    console.log(`  created release (id ${release.id})`);
  }

  // Replace an existing asset of the same name rather than 422-ing on upload.
  const existing = (release.assets ?? []).find((a) => a.name === path.basename(tgz));
  if (existing) {
    await api("DELETE", `${API}/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`);
    console.log(`  removed previous asset ${existing.name}`);
  }

  const bytes = await readFile(tgz);
  const uploadUrl = `${UPLOADS}/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(path.basename(tgz))}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `token ${token}`,
      "content-type": "application/octet-stream",
      "user-agent": "agent2llm-release",
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`asset upload -> ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const asset = await response.json();
  console.log(`  uploaded ${asset.name} (${(asset.size / 1024).toFixed(1)} KiB)`);
  console.log(`\n${asset.browser_download_url}`);
}

await main();
