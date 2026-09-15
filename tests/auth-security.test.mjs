/**
 * Auth / pairing security tests — adapted and extended from C2C.
 *
 * Covers: PKCE S256, authorization-code single use, refresh-token rotation
 * with replay detection, rate limiting, workspace-scoped token isolation and
 * secret redaction in logs.
 */
import {
  AuthStore,
  base64UrlSha256,
  filterScopes,
  safeEqual,
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
} from "@agent2llm/auth";
import { PairingManager, formatPairingCode, normalizePairingCode } from "@agent2llm/pairing";
import { redact } from "@agent2llm/logger";
import { test, assert, assertEqual } from "@agent2llm/testing";
import { report } from "./_report.mjs";

const SCOPES = ["workspace.read", "offline_access"];

function makeStore(id = "sec-test") {
  return new AuthStore(id);
}

function makeCode(store, clientId, overrides = {}) {
  return store.createAuthorizationCode({
    clientId,
    redirectUri: "http://127.0.0.1:1/cb",
    codeChallenge: base64UrlSha256("verifier-verifier-verifier"),
    scopes: SCOPES,
    pairingSessionId: "pair-1",
    ...overrides,
  });
}

test("auth", "PKCE challenge is S256 and reproducible", () => {
  const verifier = "abc123-verifier-abc123-verifier";
  const challenge = base64UrlSha256(verifier);
  assertEqual(challenge, base64UrlSha256(verifier), "S256 must be deterministic");
  assert(challenge !== verifier, "the challenge must not be the verifier");
  assert(!/[+/=]/.test(challenge), "must be base64url");
});

test("auth", "safeEqual does not leak length", () => {
  assert(safeEqual("abc", "abc"), "equal strings");
  assert(!safeEqual("abc", "abd"), "different strings");
  assert(!safeEqual("abc", "abcd"), "different lengths");
});

test("auth", "scope filtering drops unknown scopes", () => {
  const scopes = filterScopes("workspace.read shell.execute nonsense");
  assert(!scopes.includes("nonsense"), "unknown scopes are dropped");
  assert(scopes.length <= 2, `unexpected scopes: ${scopes.join(",")}`);
});

test("auth", "authorization codes are single use", () => {
  const store = makeStore();
  const client = store.registerClient({ redirectUris: ["http://127.0.0.1:1/cb"] });
  const code = makeCode(store, client.clientId, { sessionId: "s1" });
  assert(store.consumeAuthorizationCode(code) !== null, "first use must succeed");
  assertEqual(store.consumeAuthorizationCode(code), null, "replay must fail");
});

test("auth", "an unknown authorization code is rejected", () => {
  const store = makeStore();
  assertEqual(store.consumeAuthorizationCode("a2l_ac_does-not-exist"), null);
});

test("auth", "authorization code TTL is bounded", () => {
  assert(AUTH_CODE_TTL_MS <= 10 * 60_000, "codes must not live longer than 10 minutes");
  assert(ACCESS_TOKEN_TTL_MS <= 24 * 60 * 60_000, "access tokens must not outlive a day");
});

test("auth", "refresh tokens rotate and detect replay", () => {
  const store = makeStore();
  const issued = store.issueTokens({ clientId: "client-1", scopes: SCOPES, workspaceId: "w1", sessionId: "s1" });
  assert(issued.refreshToken !== null, "offline_access must yield a refresh token");

  const rotated = store.refresh(issued.refreshToken, "client-1");
  assert(rotated.ok, "first refresh must succeed");
  if (!rotated.ok) return;
  assert(rotated.tokens.refreshToken !== issued.refreshToken, "the refresh token must rotate");

  const replay = store.refresh(issued.refreshToken, "client-1");
  assertEqual(replay.ok, false, "old refresh token replay must fail");
});

test("auth", "refresh fails for the wrong client", () => {
  const store = makeStore();
  const issued = store.issueTokens({ clientId: "client-1", scopes: SCOPES, workspaceId: "w1" });
  const refreshToken = issued.refreshToken ?? "";
  const wrong = store.refresh(refreshToken, "client-2");
  assertEqual(wrong.ok, false, "a refresh token is bound to its client");
  if (!wrong.ok) assertEqual(wrong.reason, "invalid_client");
  assert(store.verifyAccessToken(issued.accessToken).ok, "the original token is untouched");
});

test("auth", "access tokens are workspace scoped", () => {
  const storeA = makeStore("ws-a");
  const storeB = makeStore("ws-b");
  const tokensA = storeA.issueTokens({ clientId: "c", scopes: SCOPES, workspaceId: "ws-a" });
  assert(storeA.verifyAccessToken(tokensA.accessToken).ok, "valid in its own workspace");
  assert(!storeB.verifyAccessToken(tokensA.accessToken).ok, "a token from A must not verify in B");
});

test("auth", "revocation is immediate", () => {
  const store = makeStore("ws-revoke");
  const tokens = store.issueTokens({ clientId: "c", scopes: SCOPES, workspaceId: "ws-revoke" });
  assert(store.verifyAccessToken(tokens.accessToken).ok, "valid before revoke");
  store.revokeToken(tokens.accessToken);
  assert(!store.verifyAccessToken(tokens.accessToken).ok, "invalid after revoke");
});

test("auth", "revokeAll clears every token", () => {
  const store = makeStore("ws-revoke-all");
  store.issueTokens({ clientId: "c1", scopes: SCOPES, workspaceId: "ws-revoke-all" });
  store.issueTokens({ clientId: "c2", scopes: SCOPES, workspaceId: "ws-revoke-all" });
  assert(store.tokenCount() >= 2, "two tokens issued");
  const revoked = store.revokeAll();
  assert(revoked >= 2, `expected 2 revocations, got ${revoked}`);
  assertEqual(store.tokenCount(), 0, "no tokens remain");
});

test("pairing", "codes are formatted, normalized and one-time", () => {
  const pairing = new PairingManager("pair-ws");
  const session = pairing.create();
  assert(session.code.length >= 8, "codes must be long enough to be unguessable");
  assertEqual(normalizePairingCode(session.code).length, 8, "normalized to 8 unambiguous chars");
  assertEqual(formatPairingCode("ABCDEFGH"), "ABCD-EFGH", "display format");

  assert(pairing.verify(session.code).ok, "first use succeeds");
  assertEqual(pairing.verify(session.code).ok, false, "second use fails");
});

test("pairing", "wrong codes burn attempts and never leak validity", () => {
  const pairing = new PairingManager("pair-ws-2", { maxAttempts: 3 });
  pairing.create();
  for (let i = 0; i < 2; i++) {
    const result = pairing.verify("ZZZZ-ZZZZ");
    assertEqual(result.ok, false);
    if (!result.ok) assertEqual(result.reason, "invalid", "wrong code is simply invalid");
  }
  const last = pairing.verify("ZZZZ-ZZZZ");
  assertEqual(last.ok, false);
  if (!last.ok) assertEqual(last.reason, "too_many_attempts", "attempt budget is enforced");
});

test("pairing", "expired sessions stop working", () => {
  let clock = 1_000_000;
  const pairing = new PairingManager("pair-ws-3", { ttlMs: 1000, now: () => clock });
  const session = pairing.create();
  clock += 2000;
  const result = pairing.verify(session.code);
  assertEqual(result.ok, false, "an expired code must not verify");
  if (!result.ok) assertEqual(result.reason, "expired");
  assert(!pairing.hasActiveSession(), "no active session remains");
});

test("pairing", "IP rate limiting is enforced", () => {
  const pairing = new PairingManager("pair-ws-4", { maxAttempts: 100, ipRateLimit: 3 });
  pairing.create();
  for (let i = 0; i < 3; i++) pairing.verify("ZZZZ-ZZZZ", "1.2.3.4");
  const limited = pairing.verify("ZZZZ-ZZZZ", "1.2.3.4");
  assertEqual(limited.ok, false);
  if (!limited.ok) assertEqual(limited.reason, "rate_limited", "the 4th attempt must be throttled");
});

test("pairing", "invalidateAll ends every session", () => {
  const pairing = new PairingManager("pair-ws-5");
  const session = pairing.create();
  pairing.invalidateAll();
  assertEqual(pairing.verify(session.code).ok, false, "no session survives invalidateAll");
  assert(!pairing.hasActiveSession(), "no active session remains");
  assertEqual(pairing.peek().sessions, 0, "peek never exposes codes");
});

test("logger", "secrets are redacted", () => {
  const token = "a2l_at_" + "x".repeat(30);
  const out = redact(`using ${token} now`);
  assert(!out.includes(token), "token must not survive");
  assert(out.includes("[REDACTED]"), "a redaction marker is required");

  const authHeader = redact("authorization: Bearer abcdefghijklmnop");
  assert(!authHeader.includes("abcdefghijklmnop"), "bearer tokens must not survive");

  const key = redact("api_key: sk-abcdefghijklmnopqrstuv");
  assert(!key.includes("sk-abcdefghijklmnopqrstuv"), "api keys must not survive");

  const pairing = redact("pairing code ABCD-EFGH");
  assert(!pairing.includes("ABCD-EFGH"), "pairing codes must not survive");
});


await report();
