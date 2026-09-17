/**
 * What a capability report is allowed to claim without having looked.
 *
 * This exists because Codex was reported as a dead adapter on a machine where
 * it was installed, signed in, and fully usable. The cause was not in Codex:
 * every `detectAll` caller passed `quick: true`, which skips both the version
 * probe and the `--help` read. The adapter then answered `hasFlag("exec")` for
 * a question nobody had asked, and `false` is indistinguishable from "this
 * build genuinely lacks the flag". So `agent2llm detect` printed
 * `version: unknown`, switched every capability off, and asserted the outright
 * false note "`codex exec` was not advertised by this build".
 *
 * The rule these tests pin down: a *quick* probe may decline to answer, but it
 * must never turn "not measured" into a negative claim — and reading
 * capabilities must be enough to force the real probe, because that is the
 * moment a human is about to read the numbers.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { createCodexHarness } from "@agent2llm/harness-codex";
import { report } from "./_report.mjs";

test("probe-depth", "a quick detect does not claim a flag surface it never read", async () => {
  const adapter = createCodexHarness();
  const detection = await adapter.detect({ quick: true });

  // Quick is allowed to come back empty-handed; it is not allowed to lie.
  if (detection.status !== "detected") return;

  const notes = (detection.notes ?? []).join(" ");
  assert(
    !/was not advertised/i.test(notes),
    `a quick probe must not report a negative capability finding, got: ${notes}`
  );
  assertEqual(detection.version, undefined, "quick must not pay for a version probe");
});

test("probe-depth", "reading capabilities forces the full probe", async () => {
  const adapter = createCodexHarness();
  await adapter.detect({ quick: true });

  // The manifest is what `agent2llm adapters` / `doctor` print, so asking for
  // it is the signal that a real answer is now required.
  const caps = await adapter.capabilitiesResolved();

  assert(caps.facts, "a resolved manifest must carry facts");
  const version = caps.facts.version;
  assert(
    typeof version === "string" && version !== "unknown",
    `resolving capabilities must read the real version, got: ${String(version)}`
  );
  assertEqual(
    caps.facts.execSubcommand,
    true,
    "the exec subcommand must be discovered from `codex exec --help`"
  );
});

test("probe-depth", "a full detect and a resolved manifest agree", async () => {
  const full = createCodexHarness();
  const detection = await full.detect({ quick: false });
  if (detection.status !== "detected") return;
  const caps = await full.capabilities();

  assert(detection.version !== undefined, "a full detect must carry a version");
  assertEqual(
    caps.facts.version,
    detection.version,
    "the manifest and the detection must not disagree about the version"
  );
  assertEqual(
    caps.version,
    detection.version,
    "the manifest's own version field must match the detection"
  );
});

/**
 * An unmeasured sign-in state is not a failed one.
 *
 * Every adapter that cannot read another product's credentials must say
 * "unknown", because it has no way to know. Writing `false` made the
 * compatibility check refuse the run outright, which meant no Web Brain ever
 * reached the window where a human signs in — the sign-in step was
 * unreachable by construction.
 */
test("probe-depth", "an unmeasured auth state is reported as unknown, not false-passed", async () => {
  const adapter = createCodexHarness();
  await adapter.detect({ quick: false });
  const caps = await adapter.capabilitiesResolved();

  assert(caps.auth, "every manifest declares auth");
  assertEqual(
    caps.auth.checked,
    false,
    "Agent2LLM cannot read Codex's credentials, so it must not claim it did"
  );
});

await report();
