/**
 * Shared runtime for web-based Brains (ChatGPT, Claude, ...).
 *
 * Extracted so that:
 *   - browser control lives in Core transports, never inside a Harness
 *   - each Brain adapter only contributes URLs, selectors and its boot prompt
 *   - the conversation URL survives restarts (`session resume`)
 *
 * Transport choice is the interesting part. Three ways exist to reach a Web
 * Brain, and they are ordered by how little they disturb the user:
 *
 *   cdp         attach to a window that is already open and signed in
 *   playwright  launch a browser we own, with a cold profile
 *   manual      no automation; the human carries the messages by hand
 *
 * Attaching wins when a window is available because it costs no second login,
 * keeps the conversation in a window the user can inspect, and does not carry
 * the signature of a freshly launched automation browser.
 *
 * Security posture: official UI automation only. No cookie export, no token
 * scraping, no proxying, no CAPTCHA/2FA automation.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "@agent2llm/config";
import { authenticationRequired, browserFailure } from "@agent2llm/core";
import type { UserActionRequest } from "@agent2llm/adapter-sdk";
import {
  ATTACH_ENDPOINT_ENV,
  CdpBrowserTransport,
  ManualBrowserTransport,
  PlaywrightBrowserTransport,
  findAttachEndpoint,
  probeAttachEndpoint,
  probeBrowserModule,
  type BrowserLaunchOptions,
  type BrowserSelectors,
  type BrowserTransport,
} from "@agent2llm/transports";

/** Re-exported so a Brain adapter can name the variable without a second import. */
export { ATTACH_ENDPOINT_ENV };

export type WebTransportMode = "cdp" | "playwright" | "manual";

export interface WebBrainConfig {
  adapterId: string;
  displayName: string;
  /** URL opened for a brand new conversation. */
  newConversationUrl: string;
  /** URL prefix that identifies a conversation of this Brain. */
  conversationUrlPrefix: string;
  /** Where the user configures the remote MCP connector. */
  connectorUrl: string;
  selectors: BrowserSelectors;
}

export interface WebBrainRef {
  mode: WebTransportMode;
  url: string;
  /** Present when mode is `cdp`: the endpoint the session attached to. */
  endpoint?: string;
  lastMessage: string;
  savedAt: string;
}

/** What a session needs to know to build its transport. */
export interface WebSessionTransport {
  mode: WebTransportMode;
  endpoint?: string;
}

export interface WebRuntimeDeps {
  logger?: { info(message: string): void; warn(message: string): void; debug(message: string): void };
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

function stateFile(adapterId: string): string {
  return path.join(ensureDir(path.join(getStateDir(), "brains")), `${adapterId}.json`);
}

export function loadWebRef(adapterId: string): WebBrainRef | null {
  return readJsonIfExists<WebBrainRef>(stateFile(adapterId));
}

export function saveWebRef(adapterId: string, ref: WebBrainRef): void {
  writeSecureJson(stateFile(adapterId), ref);
}

export function clearWebRef(adapterId: string): void {
  fs.rmSync(stateFile(adapterId), { force: true });
}

export function userDataDir(adapterId: string): string {
  return ensureDir(path.join(getStateDir(), "browser-profiles", adapterId));
}

export interface TransportSelection {
  mode: WebTransportMode;
  endpoint?: string;
  /** Why this mode was picked. Printed by `detect`/`doctor`; it is not decoration. */
  reason: string;
}

export interface TransportSelectionOptions {
  /** Never automate: use the manual transport whatever else is available. */
  forceManual?: boolean;
  /** Attach to this endpoint. Skips the port sweep. */
  endpoint?: string;
  /** Fail instead of falling back when `endpoint` does not answer. */
  requireAttach?: boolean;
  /** Ports to sweep when no endpoint is given. */
  ports?: number[];
  /** Per-port probe timeout. This runs on every detect, so keep it small. */
  timeoutMs?: number;
}

/**
 * Decide how to reach a Web Brain, preferring a window that already exists.
 *
 * A port only counts as attachable if `/json/version` answered on it. An open
 * socket is not evidence — anything can hold a port — and guessing here would
 * turn "no window" into a confusing protocol failure later.
 */
export async function selectTransport(
  options: TransportSelectionOptions = {}
): Promise<TransportSelection> {
  if (options.forceManual) {
    return { mode: "manual", reason: "Manual transport was requested." };
  }

  const requested = options.endpoint ?? process.env[ATTACH_ENDPOINT_ENV]?.trim() ?? "";
  const timeoutMs = options.timeoutMs ?? 800;
  const attach = requested
    ? await probeAttachEndpoint(requested, { timeoutMs })
    : await findAttachEndpoint({ ...(options.ports ? { ports: options.ports } : {}), timeoutMs });

  if (attach) {
    return {
      mode: "cdp",
      endpoint: attach.endpoint,
      reason: `Attaching to ${attach.browser ?? "a Chromium window"} at ${attach.endpoint}.`,
    };
  }

  if (requested && options.requireAttach) {
    throw browserFailure(
      `Nothing answered at ${requested}. Start the window with a DevTools port, or drop requireAttach to allow a browser launch.`,
      { retryable: false }
    );
  }

  if (probeBrowserModule().installed) {
    return {
      mode: "playwright",
      reason: "No window to attach to; launching a browser with its own profile.",
    };
  }

  return {
    mode: "manual",
    reason: "No DevTools endpoint answered and Playwright is not installed.",
  };
}

/**
 * Narrow an untrusted `ref.mode` back to a known transport.
 *
 * Saved state is on disk and may predate a transport that exists now, or come
 * from a newer build than the one reading it. Anything unrecognised resolves
 * to `manual`: that path needs no browser and no dependency, so a corrupt ref
 * degrades into "ask the human" rather than into a crash or a silent launch.
 */
export function asTransportMode(value: unknown): WebTransportMode {
  return value === "cdp" || value === "playwright" || value === "manual" ? value : "manual";
}

/**
 * Drives one browser-backed conversation.
 *
 * `ref` is the only thing the Core sees; it never contains cookies or tokens.
 */
export class WebBrainSession {
  private transport: BrowserTransport | null = null;
  private mode: WebTransportMode;
  private endpoint?: string;

  constructor(
    private readonly config: WebBrainConfig,
    transport: WebTransportMode | WebSessionTransport,
    private readonly deps: WebRuntimeDeps = {}
  ) {
    const normalized: WebSessionTransport =
      typeof transport === "string" ? { mode: transport } : transport;
    this.mode = normalized.mode;
    this.endpoint = normalized.endpoint;
  }

  get transportMode(): WebTransportMode {
    return this.mode;
  }

  get transportEndpoint(): string | undefined {
    return this.endpoint;
  }

  private build(): BrowserTransport {
    if (this.mode === "cdp") return new CdpBrowserTransport(this.config.selectors);
    if (this.mode === "playwright") return new PlaywrightBrowserTransport(this.config.selectors);
    return new ManualBrowserTransport(
      path.join(getStateDir(), "manual-transport", this.config.adapterId)
    );
  }

  /**
   * Refuse to pretend a desktop application shell is the website.
   *
   * A packaged desktop build can expose a DevTools port and be attached to
   * successfully, and still be unusable by this adapter: it renders its own UI
   * from a private `app://` scheme rather than loading the website, so the
   * site's selectors describe nothing on it. That is a real limitation of
   * driving the app, not a bug in the attach path, and it deserves a sentence
   * the user can act on rather than a timeout on a missing composer.
   *
   * Checked here, in the runtime every web Brain shares, so each adapter does
   * not have to rediscover it.
   */
  private assertNotApplicationShell(transport: BrowserTransport): void {
    if (!(transport instanceof CdpBrowserTransport)) return;
    if (!transport.attachedToApplicationShell) return;
    throw browserFailure(
      `Attached to an application window (${transport.shellUrl}) rather than to ${this.config.displayName} on the web. ` +
        `The desktop build serves its own interface and is not the website, so the ${this.config.displayName} selectors do not apply to it. ` +
        `Use the web app in a browser with a DevTools port instead, or run with --transport manual to carry messages by hand.`,
      { retryable: false }
    );
  }

  private launchOptions(): BrowserLaunchOptions {
    if (this.mode === "cdp") {
      return {
        endpoint: this.endpoint,
        targetUrl: this.config.newConversationUrl,
        timeoutMs: 20_000,
      };
    }
    if (this.mode === "playwright") {
      return { userDataDir: userDataDir(this.config.adapterId), headless: false };
    }
    return {};
  }

  async open(url: string): Promise<WebBrainRef> {
    const transport = this.build();
    await transport.launch(this.launchOptions());
    await transport.open(url);
    this.assertNotApplicationShell(transport);
    this.transport = transport;

    if (this.mode === "manual") {
      await this.deps.requestUserAction?.({
        kind: "login",
        message: `Open ${url} in your browser, sign in to ${this.config.displayName}, then continue.`,
        url,
      });
    }

    const state = await transport.state();
    if (!state.loggedIn && this.mode !== "manual") {
      await this.deps.requestUserAction?.({
        kind: "login",
        message: `Sign in to ${this.config.displayName} in the window that just opened.`,
        url,
      });
      const after = await transport.state();
      if (!after.loggedIn) {
        throw authenticationRequired(
          `${this.config.displayName} is not signed in. Complete the official login flow and retry.`
        );
      }
    }

    const ref: WebBrainRef = {
      mode: this.mode,
      url,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      lastMessage: state.lastAssistantMessage,
      savedAt: new Date().toISOString(),
    };
    saveWebRef(this.config.adapterId, ref);
    return ref;
  }

  private require(): BrowserTransport {
    if (!this.transport) {
      throw browserFailure(
        `${this.config.displayName} session is not open. Create or attach a session first.`,
        { retryable: false }
      );
    }
    return this.transport;
  }

  async attach(ref: WebBrainRef): Promise<void> {
    this.mode = ref.mode;
    this.endpoint = ref.endpoint;
    const transport = this.build();
    await transport.launch(this.launchOptions());
    await transport.open(ref.url);
    this.assertNotApplicationShell(transport);
    this.transport = transport;
  }

  async send(text: string): Promise<void> {
    const transport = this.require();
    await transport.type(text);
    await transport.submit();
  }

  async awaitReply(options: { timeoutMs?: number } = {}): Promise<string> {
    const transport = this.require();
    const reply = await transport.waitForReply({ timeoutMs: options.timeoutMs ?? 240_000 });
    const ref = loadWebRef(this.config.adapterId);
    if (ref) {
      saveWebRef(this.config.adapterId, {
        ...ref,
        lastMessage: reply.slice(0, 4000),
        savedAt: new Date().toISOString(),
      });
    }
    return reply;
  }

  async close(): Promise<void> {
    if (this.transport) await this.transport.close().catch(() => undefined);
    this.transport = null;
  }
}
