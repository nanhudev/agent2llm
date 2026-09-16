/**
 * Page-driving logic shared by every Chromium-backed transport.
 *
 * The transports differ in exactly one place: how they get hold of a browser
 * context.
 *
 *   PlaywrightBrowserTransport  launches a browser with a private profile
 *   CdpBrowserTransport        attaches to a window the user already has open
 *
 * Finding the composer, typing, submitting, reading the reply and detecting a
 * challenge are identical afterwards, so they live here once. Keeping them in
 * one place is also what makes the two paths behave the same under test.
 *
 * Hard rules inherited by both, enforced by contract rather than convention:
 *   - official website UI automation only
 *   - no reverse proxy, no private API interception
 *   - no cookie export, no token scraping, no profile upload
 *   - CAPTCHA / 2FA / security confirmations are surfaced as
 *     USER_ACTION_REQUIRED and never automated around
 */
import { browserFailure, timeoutError, userActionRequired } from "@agent2llm/core";
import type {
  BrowserLaunchOptions,
  BrowserPageState,
  BrowserSelectors,
  BrowserTransport,
} from "./browser.js";

/** Structural stand-ins: Playwright is optional, so we never import its types. */
export interface ElementHandleLike {
  innerText(): Promise<string>;
}

export interface PageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  $(selector: string): Promise<ElementHandleLike | null>;
  $$eval(selector: string, fn: unknown, arg?: unknown): Promise<unknown>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  keyboard: { type(text: string): Promise<void>; press(key: string): Promise<void> };
  close(): Promise<void>;
}

export interface BrowserContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface BrowserLike {
  contexts(): BrowserContextLike[];
  close(): Promise<void>;
  isConnected?(): boolean;
  version?(): string;
}

export interface PlaywrightLike {
  chromium: {
    launchPersistentContext(
      dir: string,
      options: Record<string, unknown>
    ): Promise<BrowserContextLike>;
    connectOverCDP(endpoint: string, options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

export interface ContextHandle {
  context: BrowserContextLike;
  browser: BrowserLike | null;
}

export const DEFAULT_ACTION_TIMEOUT = 20_000;

/** Host part of a URL, used to recognise a tab that already shows a site. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export abstract class ChromiumPageTransport implements BrowserTransport {
  abstract readonly kind: string;

  protected context: BrowserContextLike | null = null;
  protected browser: BrowserLike | null = null;
  protected page: PageLike | null = null;

  /**
   * What was on screen when the last message was submitted. A reply is
   * detected by comparing the live screen against this, so the reference
   * point has to be taken at send time rather than at wait time.
   */
  private baseline: { count: number; last: string } | null = null;

  private readonly actionTimeout: number;

  protected constructor(
    protected readonly selectors: BrowserSelectors,
    options: { actionTimeout?: number } = {}
  ) {
    this.actionTimeout = options.actionTimeout ?? DEFAULT_ACTION_TIMEOUT;
  }

  /** Subclass-specific: obtain a context, by launching or by attaching. */
  protected abstract openContext(options: BrowserLaunchOptions): Promise<ContextHandle>;

  /**
   * Release whatever `openContext` produced. The default is safe for a
   * borrowed window; transports that launched their own browser override it.
   */
  protected async releaseContext(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch(options: BrowserLaunchOptions = {}): Promise<void> {
    if (this.context) return;
    const handle = await this.openContext(options);
    this.context = handle.context;
    this.browser = handle.browser;
    this.page = await this.selectPage(options);
  }

  /**
   * Which tab to drive. The default takes the first one; the CDP transport
   * overrides this to prefer a tab that is already on the target site, so an
   * attached session reuses the user's signed-in conversation instead of
   * opening a second one.
   */
  protected async selectPage(_options: BrowserLaunchOptions): Promise<PageLike> {
    const pages = this.context!.pages();
    return pages.length > 0 ? pages[0]! : await this.context!.newPage();
  }

  protected requirePage(): PageLike {
    if (!this.page) {
      throw browserFailure("Browser is not open. Call launch() and open() first.", {
        retryable: false,
      });
    }
    return this.page;
  }

  async open(url: string): Promise<void> {
    const page = this.requirePage();
    // Already there? Do not reload: a reload of a signed-in conversation is
    // both slow and a needless extra request against the site.
    //
    // The `wanted !== ""` guard matters: non-http URLs (about:blank, data:,
    // file:) have an empty host, so a blank tab would otherwise look like it
    // was already on any hostless target and navigation would be skipped.
    const current = hostOf(page.url());
    const wanted = hostOf(url);
    if (wanted !== "" && current === wanted) return;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.actionTimeout });
  }

  /** Assistant messages currently on screen. */
  private async snapshot(): Promise<{ count: number; last: string }> {
    const page = this.requirePage();
    try {
      const read = (nodes: unknown[]): string[] =>
        nodes.map((node) => String((node as { innerText?: string }).innerText ?? ""));
      const texts = (await page.$$eval(this.selectors.assistantMessage, read)) as string[];
      return { count: texts.length, last: texts.length > 0 ? texts[texts.length - 1]! : "" };
    } catch {
      return { count: 0, last: "" };
    }
  }

  async state(): Promise<BrowserPageState> {
    const page = this.requirePage();
    const flag = async (selector: string | undefined): Promise<boolean> =>
      selector ? Boolean(await page.$(selector)) : false;
    const messages = await this.snapshot();
    return {
      url: page.url(),
      loggedIn: Boolean(await page.$(this.selectors.composer)),
      challenge: await flag(this.selectors.challenge),
      streaming: await flag(this.selectors.streaming),
      lastAssistantMessage: messages.last,
      messageCount: messages.count,
    };
  }

  async type(text: string): Promise<void> {
    const page = this.requirePage();
    await page.waitForSelector(this.selectors.composer, { timeout: this.actionTimeout });
    await page.click(this.selectors.composer);
    await page.keyboard.type(text);
  }

  async submit(): Promise<void> {
    const page = this.requirePage();
    // Take the baseline *before* pressing Enter, not when waitForReply()
    // starts. A local or otherwise fast Brain can have its reply on screen by
    // then, and a wait keyed to "something changed since I began looking"
    // would block until the timeout on a change that already happened.
    this.baseline = await this.snapshot();
    await page.keyboard.press("Enter");
  }

  async waitForReply(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;
    // Fall back to the live screen for callers that never called submit().
    const baseline = this.baseline ?? (await this.snapshot());
    for (;;) {
      if (options.signal?.aborted) {
        throw browserFailure("Wait for reply was cancelled.", { retryable: false });
      }
      if (Date.now() > deadline) {
        throw timeoutError(`Timed out after ${timeoutMs}ms waiting for the Brain to reply.`);
      }
      const state = await this.state();
      if (state.challenge) {
        throw userActionRequired(
          "The page is showing a login or security challenge. Complete it in the browser window, then continue."
        );
      }
      // A reply has arrived once generation has stopped and either a new
      // message appeared or the last one's text changed.
      const arrived =
        state.messageCount > baseline.count ||
        (state.lastAssistantMessage !== "" && state.lastAssistantMessage !== baseline.last);
      if (!state.streaming && arrived) return state.lastAssistantMessage;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async close(): Promise<void> {
    await this.releaseContext();
    this.context = null;
    this.browser = null;
    this.page = null;
    this.baseline = null;
  }
}
