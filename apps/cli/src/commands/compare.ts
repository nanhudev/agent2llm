import { compareRuns, RunStore } from "@agent2llm/pairs";
import * as ui from "../ui.js";

export function runCompare(ids: string[], options: { json: boolean }): number {
  if (ids.length !== 2 || ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    ui.fail("Usage: a2l compare <baseline-run-id> <candidate-run-id> [--json]");
    return 2;
  }
  const store = new RunStore();
  const baseline = store.get(ids[0]!);
  const candidate = store.get(ids[1]!);
  if (!baseline || !candidate) {
    ui.fail("Run not found or invalid. Use a2l pair show to find saved run IDs.");
    return 2;
  }
  const result = compareRuns(baseline, candidate);
  if (options.json) ui.jsonOutput(result);
  else {
    ui.heading("Observed run comparison");
    ui.line(JSON.stringify(result, null, 2));
  }
  return result.comparable ? 0 : 2;
}
