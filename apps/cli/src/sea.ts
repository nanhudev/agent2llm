/**
 * One question with two consumers: "is this the packaged single executable?"
 *
 * `index.ts` uses the answer to pick the no-command behaviour (dock instead
 * of an interactive interview), and `dock-shortcut.ts` uses it to point the
 * Windows shortcut at the exe itself. Detection is node:sea's isSea(),
 * wrapped because that module only exists from Node 22.3 — a runtime without
 * it is, by definition, not the SEA build.
 */
export async function runningInsideSea(): Promise<boolean> {
  try {
    const sea = (await import("node:sea")) as { isSea?: () => boolean };
    return typeof sea.isSea === "function" && sea.isSea();
  } catch {
    return false;
  }
}
