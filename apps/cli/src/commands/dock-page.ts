/**
 * The dock's single page.
 *
 * One self-contained document: no bundler, no framework, no network access to
 * anything but the loopback server that served it. That is not minimalism for
 * its own sake — a page that can start real executions has to be auditable in
 * one reading, and a page with no external requests cannot leak the token to a
 * third party by accident.
 *
 * The token arrives inside this HTML rather than in a cookie, because the
 * server sets no cookies at all: a credential that only exists in a document
 * the user opened themselves is not reachable by another origin.
 */

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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent2LLM Dock</title>
<style>
  :root { color-scheme: light dark; --fg:#16181d; --muted:#666b76; --bg:#f6f7f9; --card:#fff;
          --line:#e2e5ea; --accent:#3b5bdb; --ok:#1f7a3d; --warn:#8a6100; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8eaee; --muted:#9aa1ad; --bg:#16181d; --card:#1e2126; --line:#2c3037;
            --accent:#8fa5ff; --ok:#6cc48a; --warn:#e0b356; --bad:#f2867d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 24px 64px; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:0 0 10px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px;
          padding:18px; margin-bottom:16px; }
  .meta { color:var(--muted); font-size:13px; }
  .meta code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .row { display:flex; gap:8px; margin-top:14px; }
  input[type=text] { flex:1; padding:9px 11px; border:1px solid var(--line); border-radius:7px;
                     background:var(--bg); color:var(--fg); font:inherit; }
  button { padding:9px 16px; border:1px solid transparent; border-radius:7px; cursor:pointer;
           background:var(--accent); color:#fff; font:inherit; font-weight:600; }
  button[disabled] { opacity:.55; cursor:default; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px;
          border:1px solid var(--line); }
  .done { color:var(--ok); } .blocked { color:var(--warn); } .error { color:var(--bad); }
  pre { white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--line);
        border-radius:7px; padding:10px 12px; font-size:12.5px; margin:10px 0 0; }
  .empty { color:var(--muted); }
  footer { color:var(--muted); font-size:12.5px; margin-top:26px; }
</style>
</head>
<body>
<main>
  <h1>Agent2LLM Dock</h1>
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
const TOKEN = ${tokenLiteral};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, options) {
  const response = await fetch(path + "?token=" + encodeURIComponent(TOKEN), {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "HTTP " + response.status);
  return body;
}

function pairCard(pair) {
  const context = pair.context ? pair.context.root : "(no context yet)";
  return '<div class="card" data-pair="' + esc(pair.pairId) + '">' +
    '<h2>' + esc(pair.label || pair.pairId) + '</h2>' +
    '<div class="meta">' + esc(pair.brainAdapterId) + ' &times; ' + esc(pair.harnessAdapterId) +
      ' &middot; <code>' + esc(context) + '</code>' +
      ' &middot; ' + esc(pair.executionPolicy.mode) +
      ' &middot; last run: ' + esc(pair.lastRunAt ? pair.lastRunAt.replace("T", " ").slice(0, 19) : "never") +
    '</div>' +
    '<div class="row">' +
      '<input type="text" placeholder="Goal for this pair" data-goal>' +
      '<button data-run>Run</button>' +
    '</div>' +
    '<pre hidden data-out></pre>' +
  '</div>';
}

function render(state) {
  const host = document.getElementById("pairs");
  host.innerHTML = state.pairs.length
    ? state.pairs.map(pairCard).join("")
    : '<div class="card empty">No pairs yet. Create one with <code>a2l pair create --brain X --harness Y</code>.</div>';

  document.getElementById("runs").className = state.runs.length ? "" : "empty";
  document.getElementById("runs").innerHTML = state.runs.length
    ? '<div class="meta">' + state.runs.map((run) =>
        '<div><span class="' + esc(run.status) + '">' + esc(run.status) + '</span> ' +
        '<code>' + esc(run.runId) + '</code> &middot; ' + esc(run.iterations) + ' execution(s) &middot; ' +
        esc(run.goal.slice(0, 90)) + '</div>').join("") + '</div>'
    : "No runs yet.";
}

host_init();
async function host_init() {
  try { render(await api("/api/state")); }
  catch (error) { document.getElementById("pairs").innerHTML =
    '<div class="card error">Could not load state: ' + esc(error.message) +
    '<br><br>The token in this URL is required; re-run <code>a2l dock</code> for a fresh one.</div>'; }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-run]");
  if (!button) return;
  const card = button.closest("[data-pair]");
  const goal = card.querySelector("[data-goal]").value.trim();
  const out = card.querySelector("[data-out]");
  out.hidden = false;
  if (!goal) { out.textContent = "Give the Brain a goal first."; return; }
  button.disabled = true;
  out.textContent = "Running… this can take minutes; the harness is really working.";
  try {
    const result = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({ pairId: card.dataset.pair, goal }),
    });
    out.textContent = result.status.toUpperCase() + " — " + result.summary +
      "\\n\\n" + result.iterations + " execution(s) · " + result.metrics.filesChanged + " file(s) changed · " +
      (result.metrics.elapsedMs / 1000).toFixed(1) + "s" +
      (result.conversation.reused ? " · continued the same Brain conversation" : " · new Brain thread");
  } catch (error) {
    out.textContent = "Failed: " + error.message;
  } finally {
    button.disabled = false;
    try { render(await api("/api/state")); } catch (ignored) { /* the result above still stands */ }
  }
});
</script>
</body>
</html>
`;
}
