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

/**
 * Best-effort removal of a scratch directory.
 *
 * Cleanup must not decide the verdict. By the time this runs the test has
 * already made its assertions, and a temp directory is not worth a red suite —
 * the same rule `cdp-attach.test.mjs` follows for a just-killed browser that
 * still holds a handle inside its profile.
 *
 * A recursive delete of scratch space fails for at least two reasons that say
 * nothing about the code under test: a process holding a handle (EPERM on
 * Windows), and a sandbox that refuses bulk recursive deletes outright. Both
 * are real; neither is a regression. So this tries once and gives up quietly.
 *
 * Giving up quietly means leftovers accumulate where a platform refuses to
 * delete them, which is why `A2L_TEST_TMP` exists: point it at a directory you
 * are willing to clean by hand.
 *
 * @returns whether the directory is gone.
 */
export function discardScratch(dir) {
  if (!dir) return true;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
