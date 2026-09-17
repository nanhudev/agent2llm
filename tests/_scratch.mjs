/**
 * Where tests are allowed to create things.
 *
 * These tests build real repositories, so the scratch space is real disk. The
 * machine's system drive is the scarce one — the editing tools and the shell
 * both stage temporary files there — so scratch prefers a non-system drive
 * when one is present, and falls back to the platform temp directory.
 *
 * Override with `A2L_TEST_TMP` to pin it somewhere specific.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PREFERRED_DRIVES = ["D:", "E:"];

export function scratchBase() {
  const override = process.env.A2L_TEST_TMP;
  if (override && override.trim() !== "") {
    const dir = path.resolve(override.trim());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  for (const drive of PREFERRED_DRIVES) {
    if (fs.existsSync(`${drive}\\`) || fs.existsSync(`${drive}/`)) {
      const dir = path.join(`${drive}\\`, "a2l-scratch");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  }
  return os.tmpdir();
}

export function scratchDir(name) {
  return fs.mkdtempSync(path.join(scratchBase(), `${name}-`));
}
