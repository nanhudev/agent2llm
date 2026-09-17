/**
 * The dock's single page.
 *
 * Assembled here from the built assets (`src/assets.gen.ts`, produced by
 * `apps/dock/build.mjs` from `src/client.ts` + `src/styles.css`) so the served
 * document stays exactly what it always was: self-contained, no bundler
 * artifacts exposed to the network, no framework, and no request to anything
 * but the loopback server that served it. That is not minimalism for its own
 * sake — a page that can start real executions has to be auditable in one
 * reading, and a page with no external requests cannot leak the token to a
 * third party by accident.
 *
 * The token arrives inside this HTML rather than in a cookie, because the
 * server sets no cookies at all: a credential that only exists in a document
 * the user opened themselves is not reachable by another origin.
 */
import { CLI_PRIMARY_NAME, PRODUCT_NAME } from "@agent2llm/config";
import { DOCK_CSS, DOCK_JS } from "./assets.gen.js";

export interface DockPageInput {
  token: string;
  version: string;
}

/** Escapes a value for interpolation into an HTML text node or attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderDockPage(input: DockPageInput): string {
  const version = escapeHtml(input.version);
  // `JSON.stringify` alone is not enough inside a <script>: a value containing
  // `</script>` would close the element. The token is base64url today, but this
  // is the one place a future change to its alphabet would become an XSS, so
  // the guard is written down rather than assumed.
  const tokenLiteral = JSON.stringify(input.token).replace(/</g, "\\u003c");
  // The client's one piece of command advice is injected, not hard-coded, so a
  // rename of the CLI spelling cannot leave the page recommending the old name.
  const hints = JSON.stringify({ createCommand: `${CLI_PRIMARY_NAME} pair create --brain X --harness Y` });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PRODUCT_NAME} Dock</title>
<style>
${DOCK_CSS}</style>
</head>
<body>
<main>
  <h1>${PRODUCT_NAME} Dock</h1>
  <div class="sub">
    <span class="pill">v${version}</span>
    <span class="pill">loopback only</span>
    <span class="pill">token required</span>
    <span class="pill">never moves another app's window</span>
  </div>

  <div id="pairs"></div>

  <div class="card">
    <h2>Recent runs</h2>
    <div id="runs" class="empty">Loading…</div>
  </div>

  <footer>
    This page is served by <code>a2l dock</code> on 127.0.0.1 and can only be reached from
    this machine. It starts Relay runs through the same code path as <code>a2l run</code>;
    it does not talk to a cloud service, and it holds no handle to any window other than
    the tab you opened.
  </footer>
</main>
<script>
${DOCK_JS}
__a2l_dock.init(${tokenLiteral}, ${hints});
</script>
</body>
</html>
`;
}
