/**
 * The interactive launcher — what plain `a2l` does in a terminal.
 *
 * Split out of `index.ts` because the dispatch table has a hard line budget,
 * and this screen is prose-plus-prompts that grows whenever a workflow is
 * added, while the switch beside it should stay a switch. It is also the one
 * command that runs an interview, so it deliberately does NOT run inside the
 * SEA binary — a double-clicked exe has no terminal to answer prompts in.
 */
import type { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { runRun } from "./commands/run.js";
import { RECOMMENDED_BRAIN_ORDER, RECOMMENDED_HARNESS_ORDER } from "./registry.js";
import * as ui from "./ui.js";
import { BANNER } from "./usage.js";

export async function interactiveLauncher(registry: AdapterRegistry): Promise<number> {
  ui.line(BANNER);
  // Full probe: the launcher is the one screen a new user sees, and a harness
  // listed as present with no version is what makes people think the install
  // is broken. The launcher runs once, so the probe cost is paid once.
  const detections = await registry.detectAll();
  const byId = new Map(detections.map((d) => [d.id, d]));

  const show = (ids: readonly string[], title: string): void => {
    ui.heading(title);
    for (const id of ids) {
      const found = byId.get(id);
      if (!found) continue;
      const detected = found.detection.status === "detected" || found.detection.status === "verified";
      ui.line(`  ${detected ? ui.MARK_OK : ui.MARK_NO} ${found.name}`);
    }
  };
  show(RECOMMENDED_BRAIN_ORDER.filter((id) => id !== "mock-brain"), "Brains");
  show(RECOMMENDED_HARNESS_ORDER.filter((id) => id !== "mock-harness"), "Harnesses");

  const brain = await ui.promptChoice("Brain", RECOMMENDED_BRAIN_ORDER.filter((id) => byId.has(id)).map((id) => ({
    label: byId.get(id)!.name,
    value: id,
    hint: byId.get(id)!.detection.status,
  })));
  const harness = await ui.promptChoice("Harness", RECOMMENDED_HARNESS_ORDER.filter((id) => byId.has(id)).map((id) => ({
    label: byId.get(id)!.name,
    value: id,
    hint: byId.get(id)!.detection.status,
  })));
  const workflow = await ui.promptChoice("Workflow", [
    { label: "Brain / Hands", value: "brain-hands", hint: "recommended" },
    { label: "Peer", value: "peer" },
    { label: "Planner only", value: "planner-only" },
    { label: "Review only", value: "review-only" },
    { label: "Harness autonomous", value: "harness-autonomous" },
  ]);
  const workspace = await ui.promptText("Workspace", process.cwd());
  const goal = await ui.promptText("Goal");
  if (goal === "") {
    ui.warn("No goal supplied; nothing to do.");
    return 0;
  }
  return runRun(registry, { brain, harness, workflow, workspace, goal });
}
