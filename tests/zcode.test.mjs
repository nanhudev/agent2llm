import { test, assert, assertEqual, runAdapterContract } from '@agent2llm/testing';
import { ZCodeHarnessAdapter } from '@agent2llm/harness-zcode';
import { report } from './_report.mjs';

test('zcode', 'missing Desktop cannot advertise execution', async () => {
  const adapter = new ZCodeHarnessAdapter([]);
  assertEqual((await adapter.detect()).status, 'unavailable');
  assertEqual((await adapter.getActiveContext()), null);
  const caps = await adapter.capabilities();
  assert(Object.values(caps.capabilities).every(c => !c.supported));
  assertEqual(caps.auth.checked, false);
  assertEqual((await adapter.setup()).ok, false);
  let refused = false;
  try { await adapter.execute(); } catch { refused = true; }
  assert(refused, 'must refuse before spawning any runtime');
});
test('zcode', 'an installed executable is presence, not integration proof', async () => {
  const adapter = new ZCodeHarnessAdapter([process.execPath]);
  const found = await adapter.detect();
  assert(found.reason.startsWith('Desktop found.'));
  assertEqual(found.status, 'unavailable');
  assert((await runAdapterContract(adapter)).every(c => c.ok));
});
await report();
