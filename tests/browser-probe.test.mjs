/**
 * Browser capability probe.
 *
 * `probeBrowserModule` decides whether a Web Brain gets a real browser or
 * silently degrades to the manual transport. It used to call `require.resolve`
 * from inside an ESM module, where no `require` binding exists: the resulting
 * ReferenceError was swallowed by its own try/catch, so the probe answered
 * `installed:false` even with Playwright fully installed, and every Web Brain
 * quietly fell back to manual.
 *
 * These tests pin the probe to the truth: its answer must agree with whether
 * the module can actually be loaded.
 */
import { test, assert, assertEqual } from "@agent2llm/testing";
import { probeBrowserModule } from "@agent2llm/transports";
import { report } from "./_report.mjs";

async function canImport(name) {
  try {
    await import(name);
    return true;
  } catch {
    return false;
  }
}

test("browser-probe", "the probe agrees with whether the module actually loads", async () => {
  const probe = probeBrowserModule("playwright");
  const real = await canImport("playwright");
  assertEqual(
    probe.installed,
    real,
    `probe reported installed=${probe.installed} but importing playwright ${real ? "succeeded" : "failed"}`
  );
});

test("browser-probe", "a missing module reports not-installed with a reason", () => {
  const probe = probeBrowserModule("a2l-module-that-does-not-exist");
  assertEqual(probe.installed, false);
  assert(typeof probe.reason === "string" && probe.reason.length > 0, "reason must explain the fallback");
});

test("browser-probe", "the probe never throws on a nonsense name", () => {
  assertEqual(probeBrowserModule("").installed, false);
});

await report();
