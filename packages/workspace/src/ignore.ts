/**
 * ADAPTED FROM codex-with-chatgpt (MIT)
 * Copyright (c) 2026 codex-with-chatgpt contributors
 * https://github.com/XiaoDuoYa/codex-with-chatgpt
 *
 * Modifications: de-branded (Codex/C2C -> Agent2LLM/A2L), generalised beyond a
 * single harness, and re-checked against the security properties described in
 * docs/security/. See docs/C2C_REUSE_MAP.md.
 */
/**
 * Ignore + sensitive-file policy — ADAPTED from codex-with-chatgpt (MIT).
 *   upstream: src/workspace/ignore.ts
 *   changes:  reads `.agent2llmignore` and keeps `.c2cignore` for migrants,
 *             adds agent/credential patterns discovered in later audits.
 */
import ignore, { type Ignore } from "ignore";
import fs from "node:fs";
import path from "node:path";

/** Files that must never be readable through the data plane, regardless of config. */
export const SENSITIVE_PATTERNS: string[] = [
  ".env",
  ".env.*",
  "!.env.example",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_rsa.*",
  "id_ed25519",
  "id_ed25519.*",
  "id_ecdsa",
  "id_ecdsa.*",
  "id_dsa",
  "id_dsa.*",
  ".ssh/",
  ".aws/",
  ".gnupg/",
  ".npmrc",
  ".netrc",
  "_netrc",
  ".git-credentials",
  "*.keychain",
  "*.keychain-db",
  ".cloudflared/",
  "credentials.json",
  "service-account*.json",
  "secrets.json",
  "cookies.sqlite",
  "Cookies",
  ".agent2llm-secrets*",
  ".c2c-secrets*",
  "*.pfx",
  ".direnv/",
];

/** High-noise directories hidden from listing/search (not an error). */
export const NOISE_PATTERNS: string[] = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  "coverage/",
  ".cache/",
  ".turbo/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".pytest_cache/",
  ".mypy_cache/",
  "target/",
  ".gradle/",
  ".idea/",
  ".tooling/",
  ".pnpm-store/",
  ".DS_Store",
  "*.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
];

export const CUSTOM_IGNORE_FILES = [".agent2llmignore", ".c2cignore"] as const;

export class IgnoreRules {
  private readonly sensitive: Ignore;
  private readonly noise: Ignore;
  private readonly custom: Ignore;

  constructor(workspaceRoot: string) {
    this.sensitive = ignore().add(SENSITIVE_PATTERNS);
    this.noise = ignore().add(NOISE_PATTERNS);
    this.custom = ignore();
    for (const file of CUSTOM_IGNORE_FILES) {
      const target = path.join(workspaceRoot, file);
      try {
        if (fs.existsSync(target)) this.custom.add(fs.readFileSync(target, "utf8"));
      } catch {
        // unreadable ignore file: fall back to defaults
      }
    }
  }

  /** Deny with ACCESS_DENIED_SENSITIVE_FILE. */
  isSensitive(relPath: string): boolean {
    if (!relPath || relPath === ".") return false;
    return this.sensitive.ignores(relPath) || this.custom.ignores(relPath);
  }

  /** Hide from listing/search (not an error). */
  isNoise(relPath: string): boolean {
    if (!relPath || relPath === ".") return false;
    return this.noise.ignores(relPath);
  }

  isHidden(relPath: string): boolean {
    return this.isSensitive(relPath) || this.isNoise(relPath);
  }

  /** Git pathspec excludes so diffs honour the same policy. */
  gitPathspecExcludes(): string[] {
    return SENSITIVE_PATTERNS.filter((pattern) => !pattern.startsWith("!")).map(
      (pattern) => `:(exclude)${pattern}`
    );
  }
}
