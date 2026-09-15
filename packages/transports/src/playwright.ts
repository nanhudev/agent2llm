import { browserFailure, timeoutError, userActionRequired } from "@agent2llm/core";
import type {
  BrowserLaunchOptions,
  BrowserPageState,
  BrowserSelectors,
  BrowserTransport,
} from "./browser.js";

/**
 * Playwright-backed transport over the *official* ChatGPT / Claude web UIs.
 *
 * Playwright is loaded lazily and is an optional peer dependency, so a plain
 * `npm install agent2llm` never pulls a browser engine.
 */
interface PlaywrightLike {
  chromium: {
    launchPersistentContext(
      dir: string,
      options: Record<string, unknown>
    ): Promise<BrowserContextLike>;
  };
}

interface BrowserContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  $(selector: string): Promise<ElementHandleLike | null>;
  $$eval(selector: string, fn: unknown, arg?: unknown): Promise<unknown>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  keyboard: { type(text: string): Promise<void>; press(key: string): Promise<void> };
  close(): Promise<void>;
}

interface ElementHandleLike {
  innerText(): Promise<string>;
}

const DEFAULT_TIMEOUT = 20_000;

export class PlaywrightBrowserTransport implements BrowserTransport {
  readonly kind = "playwright";

  private context: BrowserContextLike | null = null;
  private page: PageLike | null = null;
  private playwright: PlaywrightLike | null = null;

  constructor(private readonly selectors: BrowserSelectors) {}

  private async require(page: PageLike | null): Promise<PageLike> {
    if (!page) throw browserFailure("Browser is not open. Call launch() and open() first.", { retryable: false });
    return page;
  }

  async launch(options: BrowserLaunchOptions = {}): Promise<void> {
    if (this.context) return;
    let mod: unknown;
    try {
      mod = await import("playwright");
    } catch (error) {
      throw browserFailure(
        "Playwright is not installed. Install it with `npm i -D playwright && npx playwright install chromium`, or use the manual transport.",
        { cause: error, retryable: false }
      );
    }
    this.playwright = mod as PlaywrightLike;
    const dir = options.userDataDir;
    if (!dir) {
      throw browserFailure("A persistent user data directory is required for the Playwright transport.", {
        retryable: false,
      });
    }
    this.context = await this.playwright.chromium.launchPersistentContext(dir, {
      headless: options.headless ?? false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0]! : await this.context.newPage();
    void options.captureScreenshots;
  }

  async open(url: string): Promise<void> {
    const page = await this.require(this.page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
  }

  async state(): Promise<BrowserPageState> {
    const page = await this.require(this.page);
    const flag = async (selector: string | undefined): Promise<boolean> =>
      selector ? Boolean(await page.$(selector)) : false;
    const last = await this.readLastMessage();
    return {
      url: page.url(),
      loggedIn: Boolean(await page.$(this.selectors.composer)),
      challenge: await flag(this.selectors.challenge),
      streaming: await flag(this.selectors.streaming),
      lastAssistantMessage: last,
    };
  }

  private async readLastMessage(): Promise<string> {
    const page = await this.require(this.page);
    try {
      const read = (nodes: unknown[]): string[] =>
        nodes.map((node) => String((node as { innerText?: string }).innerText ?? ""));
      const texts = (await page.$$eval(this.selectors.assistantMessage, read)) as string[];
      return texts.length > 0 ? texts[texts.length - 1]! : "";
    } catch {
      return "";
    }
  }

  async type(text: string): Promise<void> {
    const page = await this.require(this.page);
    await page.waitForSelector(this.selectors.composer, { timeout: DEFAULT_TIMEOUT });
    await page.click(this.selectors.composer);
    await page.keyboard.type(text);
  }

  async submit(): Promise<void> {
    const page = await this.require(this.page);
    await page.keyboard.press("Enter");
  }

  async waitForReply(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;
    const before = await this.readLastMessage();
    for (;;) {
      if (options.signal?.aborted) throw browserFailure("Wait for reply was cancelled.", { retryable: false });
      if (Date.now() > deadline) {
        throw timeoutError(`Timed out after ${timeoutMs}ms waiting for the Brain to reply.`);
      }
      const state = await this.state();
      if (state.challenge) {
        throw userActionRequired(
          "The page is showing a login or security challenge. Complete it in the browser window, then continue."
        );
      }
      if (!state.streaming && state.lastAssistantMessage && state.lastAssistantMessage !== before) {
        return state.lastAssistantMessage;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined);
    this.context = null;
    this.page = null;
  }
}
