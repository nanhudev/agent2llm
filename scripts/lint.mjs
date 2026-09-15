/**
 * Static checks that do not need a linter dependency:
 *   - no `any` in package sources (typed boundaries only)
 *   - modules stay small (< 400 lines by default)
 *   - no TODO/FIXME on the core path
 *   - no accidental secrets committed in source
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIRS = ["packages", "apps"];
const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !full.includes(`${path.sep}dist${path.sep}`)) {
      check(full);
    }
  }
}

const ANY_RE = /:\s*any\b|\bas any\b|<any>/;
const TODO_RE = /\bTODO\b|\bFIXME\b/;
const SECRET_RE = /(sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,})/;

function check(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rel = path.relative(ROOT, file).split(path.sep).join("/");

  if (lines.length > 400) {
    problems.push(`${rel}: ${lines.length} lines (> 400) — split the module`);
  }
  lines.forEach((line, index) => {
    if (ANY_RE.test(line) && !line.includes("// eslint-disable")) {
      problems.push(`${rel}:${index + 1}: 'any' is not allowed outside typed boundaries`);
    }
    if (TODO_RE.test(line)) {
      problems.push(`${rel}:${index + 1}: TODO/FIXME left in source`);
    }
    if (SECRET_RE.test(line)) {
      problems.push(`${rel}:${index + 1}: possible committed secret`);
    }
  });
}

for (const dir of SRC_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}

if (problems.length === 0) {
  console.log("lint: clean");
  process.exit(0);
}
console.log(`lint: ${problems.length} problem(s)`);
for (const problem of problems) console.log(`  ${problem}`);
process.exit(1);
