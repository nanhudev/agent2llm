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
 * Sanitizer for command output released to a Brain — ADAPTED from
 * codex-with-chatgpt (MIT), upstream src/execution/sanitize.ts.
 *
 * Changes: home-path redaction made cross-platform, added adapter-specific
 * token prefixes. Security properties unchanged: private keys are withheld
 * entirely, everything else is redacted and truncated.
 */
import os from "node:os";
import path from "node:path";

const REDACTIONS: RegExp[] = [
  /a2l_(?:at|rt|ac|admin|pk)_[A-Za-z0-9_-]+/g,
  /c2c_(?:at|rt|ac|admin)_[A-Za-z0-9_-]+/g,
  /(authorization"?\s*[:=]\s*"?bearer\s+)[^\s"']+/gi,
  /((?:access_token|refresh_token|client_secret|api[_-]?key|token)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g,
  /sk-[A-Za-z0-9-]{16,}/g,
];

const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_LINES = 400;

export interface SanitizeResult {
  allowed: boolean;
  reason?: "private_key" | "empty";
  text: string;
  truncated: boolean;
  sizeBytes: number;
}

export function sanitizeOutput(raw: string): SanitizeResult {
  const sizeBytes = Buffer.byteLength(raw, "utf8");
  if (raw.trim() === "") {
    return { allowed: false, reason: "empty", text: "", truncated: false, sizeBytes };
  }
  if (PRIVATE_KEY_MARKER.test(raw)) {
    return { allowed: false, reason: "private_key", text: "", truncated: false, sizeBytes };
  }

  let text = raw;
  for (const pattern of REDACTIONS) {
    text = text.replace(pattern, (match, group1) =>
      typeof group1 === "string" ? `${group1}[REDACTED]` : "[REDACTED]"
    );
  }
  const home = os.homedir();
  if (home) {
    const normalizedHome = home.split(path.sep).join("/");
    text = text.split(home).join("~").split(normalizedHome).join("~");
  }

  const lines = text.split(/\r?\n/);
  let truncated = false;
  if (lines.length > MAX_OUTPUT_LINES) {
    text = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
    text = Buffer.from(text, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
    truncated = true;
  }
  return { allowed: true, text, truncated, sizeBytes };
}
