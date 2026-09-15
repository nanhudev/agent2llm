/**
 * Browser transport — the boundary that C2C left inside Codex.
 *
 * In Agent2LLM no Harness adapter is allowed to own a browser. Web Brains
 * (ChatGPT, Claude) need one, so the transport is a first-class Core service.
 *
 * Hard rules enforced by contract, not by convention:
 *   - official website UI automation only
 *   - no reverse proxy, no private API interception
 *   - no cookie export, no token scraping, no profile upload
 *   - CAPTCHA / 2FA / security confirmations are surfaced as
 *     USER_ACTION_REQUIRED and never automated around
 */
export interface BrowserSelectors {
  /** Input box the adapter types the control message into. */
  composer: string;
  /** Container for the latest assistant message. */
  assistantMessage: string;
  /** Presence means "still generating". */
  streaming?: string;
  /** Presence means a human must do something (login, CAPTCHA, ...). */
  challenge?: string;
}

export interface BrowserLaunchOptions {
  /** Persistent context directory; user logs in once, through the real UI. */
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  /** Opt-in debug screenshots. Never enabled by default. */
  captureScreenshots?: boolean;
}

export interface BrowserPageState {
  url: string;
  loggedIn: boolean;
  challenge: boolean;
  streaming: boolean;
  lastAssistantMessage: string;
}

export interface BrowserTransport {
  readonly kind: string;
  launch(options?: BrowserLaunchOptions): Promise<void>;
  open(url: string): Promise<void>;
  state(): Promise<BrowserPageState>;
  type(text: string): Promise<void>;
  submit(): Promise<void>;
  /** Wait until the assistant message changes and generation stops. */
  waitForReply(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserCapabilityProbe {
  installed: boolean;
  kind: string;
  reason?: string;
}

/**
 * Detects whether a browser automation backend is available *without*
 * importing it. Playwright is an optional peer dependency: Agent2LLM must
 * install and run fine without it, simply reporting the Brain as
 * `implemented / detected:false`.
 */
export function probeBrowserModule(moduleName = "playwright"): BrowserCapabilityProbe {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require.resolve(moduleName);
    return { installed: true, kind: moduleName };
  } catch (error) {
    return {
      installed: false,
      kind: moduleName,
      reason: `${moduleName} is not installed. Web Brain automation is unavailable; the manual transport still works.`,
    };
  }
}
