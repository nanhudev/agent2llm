/** Removes build output so `npm run rebuild` starts from a clean slate. */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let removed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      if (entry.name === "dist") {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
        continue;
      }
      walk(full);
    } else if (entry.name.endsWith(".tsbuildinfo")) {
      fs.rmSync(full, { force: true });
      removed++;
    }
  }
}

for (const dir of ["packages", "apps"]) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}
fs.rmSync(path.join(ROOT, "tsconfig.tsbuildinfo"), { force: true });
console.log(`clean: removed ${removed} build artifact(s)`);
