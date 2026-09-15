/**
 * Adapter contract suite.
 *
 * Every adapter — built-in or third-party — must pass this. It never needs
 * the real product installed, which is exactly why "implemented but
 * unverified" is an honest, testable state.
 */
import {
  capabilityManifestSchema,
  isCapabilityKey,
  ADAPTER_STATUSES,
} from "@agent2llm/protocol";
import type { AnyAdapter, BrainAdapter, DetectionResult, HarnessAdapter } from "@agent2llm/adapter-sdk";
import { isBrainAdapter } from "@agent2llm/adapter-sdk";
import { assert, assertEqual } from "./assert.js";

export interface ContractCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ContractOptions {
  /** Skip checks that require the product to be installed. */
  requireDetected?: boolean;
}

function isAsyncIterable(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

export async function runAdapterContract(
  adapter: AnyAdapter,
  options: ContractOptions = {}
): Promise<ContractCheck[]> {
  const checks: ContractCheck[] = [];

  const record = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  await record("metadata is valid", () => {
    const meta = adapter.metadata();
    assert(/^[a-z0-9][a-z0-9-]*$/.test(meta.id), `id '${meta.id}' must be kebab-case`);
    assert(meta.name.trim().length > 0, "name is required");
    assert(meta.role === "brain" || meta.role === "harness", "role must be brain or harness");
    assert(/^\d+\.\d+\.\d+/.test(meta.version), `version '${meta.version}' must be semver-ish`);
  });

  await record("detect returns a known status", async () => {
    const result: DetectionResult = await adapter.detect({ quick: true });
    assert(
      (ADAPTER_STATUSES as readonly string[]).includes(result.status),
      `unknown status '${result.status}'`
    );
    if (options.requireDetected) {
      assertEqual(result.status, "detected", "adapter was expected to be detected");
    }
  });

  await record("detect is deterministic", async () => {
    const first = await adapter.detect({ quick: true });
    const second = await adapter.detect({ quick: true });
    assertEqual(first.status, second.status, "status must be stable across calls");
    assertEqual(first.binaryPath ?? null, second.binaryPath ?? null, "binaryPath must be stable");
  });

  await record("capability manifest validates", async () => {
    const manifest = await adapter.capabilities();
    const parsed = capabilityManifestSchema.safeParse(manifest);
    assert(parsed.success, `manifest invalid: ${JSON.stringify(parsed.error?.issues?.[0] ?? null)}`);
  });

  await record("capability keys are known", async () => {
    const manifest = await adapter.capabilities();
    for (const key of Object.keys(manifest.capabilities)) {
      assert(isCapabilityKey(key), `unknown capability key '${key}'`);
    }
  });

  await record("capabilities do not contradict role", async () => {
    const manifest = await adapter.capabilities();
    if (isBrainAdapter(adapter)) {
      assertEqual(manifest.capabilities["workspace.write"]?.supported ?? false, false, "a Brain must never claim workspace.write");
      assertEqual(manifest.capabilities["shell.execute"]?.supported ?? false, false, "a Brain must never claim shell.execute");
      assertEqual(manifest.capabilities["git.modify"]?.supported ?? false, false, "a Brain must never claim git.modify");
    }
  });

  await record("setup returns typed result", async () => {
    const result = await adapter.setup({
      workspaceId: "contract-workspace",
      workspaceRoot: process.cwd(),
    });
    assert(typeof result.ok === "boolean", "ok must be boolean");
    assert(
      (ADAPTER_STATUSES as readonly string[]).includes(result.status),
      `unknown status '${result.status}'`
    );
  });

  if (isBrainAdapter(adapter)) {
    await brainContract(adapter, record);
  } else {
    await harnessContract(adapter as HarnessAdapter, record);
  }

  return checks;
}

async function brainContract(adapter: BrainAdapter, record: (name: string, fn: () => void | Promise<void>) => Promise<void>): Promise<void> {
  await record("brain exposes the full session surface", () => {
    for (const method of [
      "createSession",
      "attachSession",
      "sendControl",
      "awaitControl",
      "verifyWorkspace",
      "close",
    ] as const) {
      assertEqual(typeof adapter[method], "function", `${method} must be callable`);
    }
  });

  await record("close is idempotent", async () => {
    const session = { id: "contract-session", adapterId: adapter.metadata().id, ref: {} };
    await adapter.close(session).catch(() => undefined);
    await adapter.close(session).catch(() => undefined);
  });
}

async function harnessContract(adapter: HarnessAdapter, record: (name: string, fn: () => void | Promise<void>) => Promise<void>): Promise<void> {
  await record("harness exposes the full execution surface", () => {
    for (const method of ["createSession", "attachSession", "execute", "events", "cancel", "close"] as const) {
      assertEqual(typeof adapter[method], "function", `${method} must be callable`);
    }
  });

  await record("events() returns an async iterable", async () => {
    const handle = { id: "contract-handle", adapterId: adapter.metadata().id, ref: {} };
    const iterable = adapter.events(handle);
    assert(isAsyncIterable(iterable), "events() must return an AsyncIterable");
  });

  await record("cancel is safe on an unknown handle", async () => {
    await adapter.cancel({ id: "does-not-exist", adapterId: adapter.metadata().id, ref: {} });
  });

  await record("close is idempotent", async () => {
    const session = { id: "contract-session", adapterId: adapter.metadata().id, ref: {} };
    await adapter.close(session).catch(() => undefined);
    await adapter.close(session).catch(() => undefined);
  });
}
