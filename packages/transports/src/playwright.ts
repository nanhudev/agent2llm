import { browserFailure } from "@agent2llm/core";
import type { BrowserLaunchOptions, BrowserSelectors } from "./browser.js";
import { ChromiumPageTransport, type ContextHandle, type PlaywrightLike } from "./chromium.js";

/**
 * Playwright-backed transport that launches its own browser.
 *
 * This is the fallback, not the preferred path. A browser we start has an
 * empty profile — so the user signs in again — and a freshly launched Chromium
 * is precisely what anti-automation checks are built to notice. When the user
 * already has a signed-in window, CdpBrowserTransport attaches to it instead.
 *
 * Playwright is loaded lazily and is an optional peer dependency, so a plain
 * `npm install agent2llm` never pulls a browser engine.
 */
export class PlaywrightBrowserTransport extends ChromiumPageTransport {
  readonly kind = "playwright";

  constructor(selectors: BrowserSelectors) {
    super(selectors);
  }

  protected async openContext(options: BrowserLaunchOptions): Promise<ContextHandle> {
    const playwright = await loadPlaywright();
    const dir = options.userDataDir;
    if (!dir) {
      throw browserFailure(
        "A persistent user data directory is required for the Playwright transport.",
        { retryable: false }
      );
    }
    const context = await playwright.chromium.launchPersistentContext(dir, {
      headless: options.headless ?? false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    void options.captureScreenshots;
    return { context, browser: null };
  }

  /** Shutting down a browser we launched is correct: it is ours to close. */
  protected override async releaseContext(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

/**
 * Lazy loader shared by every Chromium transport, so a missing optional
 * dependency produces one consistent, actionable error.
 */
export async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    // The ambient shim types the module as `unknown`, so the cast goes
    // through `unknown` explicitly rather than pretending the shapes overlap.
    return (await import("playwright")) as unknown as PlaywrightLike;
  } catch (error) {
    throw browserFailure(
      "Playwright is not installed. Install it with `npm i -D playwright && npx playwright install chromium`, or use the manual transport.",
      { cause: error, retryable: false }
    );
  }
}
