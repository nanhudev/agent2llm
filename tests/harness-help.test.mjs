import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexHarness } from '@agent2llm/harness-codex';
import { test, assertEqual } from '@agent2llm/testing';
import { report } from './_report.mjs';

test('harness-help', 'extensionless CLI help uses the same interpreter as execution', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2l-help-contract-'));
  const file = path.join(dir, 'codex');
  fs.writeFileSync(file, '#!/usr/bin/env node\n' +
    'console.log(process.argv.includes("--version") ? "codex-cli 1.2.3" : "Usage: codex exec --json --sandbox --cd resume");\n');
  fs.chmodSync(file, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + oldPath;
  try {
    const adapter = createCodexHarness();
    await adapter.detect({ quick: true });
    const caps = await adapter.capabilitiesResolved();
    assertEqual(caps.facts.execSubcommand, true);
    assertEqual(caps.facts.jsonFlag, true);
    assertEqual(caps.facts.version, 'codex-cli 1.2.3');
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
await report();
