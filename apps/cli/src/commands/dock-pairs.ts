/**
 * The dock's pair-creation endpoint.
 *
 * The page can start runs, so it has to be able to make the thing a run
 * needs: a first Pair, without opening a terminal. The creation decisions —
 * which side is which, which context wins, when an existing pair is a
 * continuation rather than a duplicate — are exactly `a2l pair create`'s, so
 * this handler calls `createPairCore`, the function that command was
 * refactored to share. Nothing here re-decides anything; a pair made on the
 * page and a pair made in a terminal are indistinguishable on disk, which is
 * the whole point.
 *
 * It answers to the same gates as a run: the token by construction of the
 * router, then origin compared and JSON-only body enforced in `gatePost`.
 */
import http from "node:http";
import type { AdapterRegistry } from "@agent2llm/adapter-sdk";
import { createPairCore } from "./pair-select.js";
import { gatePost, json, pairsForPage, readBody } from "./dock-http.js";

export interface CreatePairDefaults {
  /** The dock's own `--workspace`, used when the page sends none. */
  workspace?: string;
}

export async function handleCreatePair(
  registry: AdapterRegistry,
  defaults: CreatePairDefaults,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number
): Promise<void> {
  if (!gatePost(req, res, port, "pair creation")) return;

  let body: { brain?: unknown; harness?: unknown; workspace?: unknown; label?: unknown; contextMode?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch (error) {
    json(res, 400, { error: `Could not read the request: ${(error as Error).message}` });
    return;
  }

  // Absent and blank are the same decision here: neither is a value the user
  // offered, so both fall through to the default or stay undefined.
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

  const outcome = await createPairCore(registry, {
    brain: str(body.brain),
    harness: str(body.harness),
    workspace: str(body.workspace) ?? defaults.workspace,
    label: str(body.label),
    contextMode: str(body.contextMode),
  });
  if (!outcome.ok) {
    json(res, 400, { error: outcome.error });
    return;
  }

  json(res, 200, {
    pair: pairsForPage([outcome.pair])[0],
    created: outcome.created,
    contextNote: outcome.note,
  });
}
