/**
 * Shared runtime for web-based Brains (ChatGPT, Claude, ...).
 *
 * Extracted so that:
 *   - browser control lives in Core transports, never inside a Harness
 *   - each Brain adapter only contributes URLs, selectors and its boot prompt
 *   - the conversation URL survives restarts (`session resume`)
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
  ManualBrowserTransport,
  PlaywrightBrowserTransport,
  probeBrowserModule,
  type BrowserSelectors,
  type BrowserTransport,
} from "@agent2llm/transports";

export type WebTransportMode = "playwright" | "manual";

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
  lastMessage: string;
  savedAt: string;
}

export interface WebRuntimeDeps {
  logger?: { info(message: string): void; warn(message: string): void; debug(message: string): void };
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
  /** Force the manual transport even when Playwright is installed. */
  forceManual?: boolean;
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

export function resolveTransportMode(config: WebBrainConfig, forceManual?: boolean): WebTransportMode {
  if (forceManual) return "manual";
  return probeBrowserModule().installed ? "playwright" : "manual";
}

/**
 * Drives one browser-backed conversation.
 *
 * `ref` is the only thing the Core sees; it never contains cookies or tokens.
 */
export class WebBrainSession {
  private transport: BrowserTransport | null = null;
  private mode: WebTransportMode;

  constructor(
    private readonly config: WebBrainConfig,
    mode: WebTransportMode,
    private readonly deps: WebRuntimeDeps = {}
  ) {
    this.mode = mode;
  }

  get transportMode(): WebTransportMode {
    return this.mode;
  }

  private build(): BrowserTransport {
    if (this.mode === "playwright") {
      return new PlaywrightBrowserTransport(this.config.selectors);
    }
    return new ManualBrowserTransport(
      path.join(getStateDir(), "manual-transport", this.config.adapterId)
    );
  }

  async open(url: string): Promise<WebBrainRef> {
    const transport = this.build();
    await transport.launch(
      this.mode === "playwright"
        ? { userDataDir: userDataDir(this.config.adapterId), headless: false }
        : {}
    );
    await transport.open(url);
    this.transport = transport;

    if (this.mode === "manual") {
      await this.deps.requestUserAction?.({
        kind: "login",
        message: `Open ${url} in your browser, sign in to ${this.config.displayName}, then continue.`,
        url,
      });
    }

    const state = await transport.state();
    if (!state.loggedIn && this.mode === "playwright") {
      await this.deps.requestUserAction?.({
        kind: "login",
        message: `Sign in to ${this.config.displayName} in the browser window that just opened.`,
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
      url: transport instanceof ManualBrowserTransport ? url : url,
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
    const transport = this.build();
    await transport.launch(
      this.mode === "playwright"
        ? { userDataDir: userDataDir(this.config.adapterId), headless: false }
        : {}
    );
    await transport.open(ref.url);
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
      saveWebRef(this.config.adapterId, { ...ref, lastMessage: reply.slice(0, 4000), savedAt: new Date().toISOString() });
    }
    return reply;
  }

  async close(): Promise<void> {
    if (this.transport) await this.transport.close().catch(() => undefined);
    this.transport = null;
  }
}
