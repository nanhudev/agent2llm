/**
 * Transport selection.
 *
 * Choosing how to reach a Web Brain is a decision where every answer has a cost
 * attached, and two of the wrong answers only surface much later: treating an
 * unreachable endpoint as attachable, and silently ignoring an endpoint the user
 * explicitly asked for. Both are cheap to check here.
 *
 * No browser is needed. A closed port on localhost refuses immediately, so these
 * cases do not wait on timeouts.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { ATTACH_ENDPOINT_ENV, resetAttachProbeCache } from "@agent2llm/transports";
import { selectTransport } from "@agent2llm/brain-web-runtime";
import { report } from "./_report.mjs";

// Derived from the pid so a parallel run on one machine cannot collide with
// another instance of this suite.
const BASE = 59000 + (process.pid % 900);
const DEAD = `http://127.0.0.1:${BASE}`;

test("transport-selection", "an unreachable endpoint is not treated as attachable", async () => {
  resetAttachProbeCache();
  const selection = await selectTransport({ endpoint: DEAD, timeoutMs: 500 });
  assert(
    selection.mode !== "cdp",
    `a dead endpoint must not select cdp (got ${selection.mode}: ${selection.reason})`
  );
});

test("transport-selection", "an endpoint that does not answer fails loudly when required", async () => {
  resetAttachProbeCache();
  let threw = false;
  try {
    await selectTransport({ endpoint: DEAD, requireAttach: true, timeoutMs: 500 });
  } catch {
    threw = true;
  }
  assert(threw, "requireAttach must turn a silent fall-through into an error");
});

test("transport-selection", "the environment variable is read as the attach endpoint", async () => {
  resetAttachProbeCache();
  const previous = process.env[ATTACH_ENDPOINT_ENV];
  process.env[ATTACH_ENDPOINT_ENV] = DEAD;
  try {
    const selection = await selectTransport({ timeoutMs: 500 });
    assert(
      selection.mode !== "cdp",
      `an unreachable ${ATTACH_ENDPOINT_ENV} must not select cdp (got ${selection.mode})`
    );
  } finally {
    if (previous === undefined) delete process.env[ATTACH_ENDPOINT_ENV];
    else process.env[ATTACH_ENDPOINT_ENV] = previous;
    resetAttachProbeCache();
  }
});

test("transport-selection", "forceManual wins over everything else", async () => {
  resetAttachProbeCache();
  const selection = await selectTransport({ forceManual: true, endpoint: DEAD });
  assertEqual(selection.mode, "manual");
  assert(selection.reason.length > 0, "every selection explains itself");
});

test("transport-selection", "the default sweep yields no attach when nothing is listening", async () => {
  resetAttachProbeCache();
  const selection = await selectTransport({
    ports: [BASE + 1, BASE + 2, BASE + 3],
    timeoutMs: 500,
  });
  assert(selection.mode !== "cdp", "no listener means no attach");
});

await report();
