import path from "node:path";
import { readShebang } from "@agent2llm/detect";

/**
 * How to actually launch a discovered binary on this platform.
 *
 * `locateBinary` reports where a CLI lives; it does not promise the OS can
 * spawn what it found. On Windows the difference is the npm global shim:
 * `npm install -g` writes `dsh` (a POSIX `#!/bin/sh` script), `dsh.cmd` and
 * `dsh.ps1` side by side, and `findInPath` returns the extensionless one first
 * because on Windows any regular file passes the executability check. Node
 * answers a direct spawn of that file with `EINVAL` — the launch dies before
 * the product ever ran, while `detect` happily reported a version, because the
 * version probe already routes shims through their shebang interpreter
 * (see `readVersion` in `@agent2llm/detect`).
 *
 * So the same trick execution needed all along: an extensionless shim is
 * launched as `sh <shim> <args…>` — argv passed through untouched, no shell
 * re-parsing of task text. Files with an extension spawn directly. A `.cmd`
 * sibling is deliberately NOT reached for: only `cmd.exe` can run one, and
 * routing task text through `cmd.exe` parsing is how an instruction becomes
 * an injection. An extensionless file without a usable shebang is returned
 * unchanged, so the spawn fails loudly with the transport's own error rather
 * than silently mutating into something unexpected.
 */
export interface SpawnInvocation {
  bin: string;
  args: readonly string[];
}

export function toSpawnable(binPath: string, args: readonly string[]): SpawnInvocation {
  if (process.platform !== "win32") return { bin: binPath, args };
  if (path.extname(binPath) !== "") return { bin: binPath, args };
  const interpreter = readShebang(binPath);
  if (interpreter) return { bin: interpreter, args: [binPath, ...args] };
  return { bin: binPath, args };
}
