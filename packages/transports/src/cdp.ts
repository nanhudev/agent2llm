/**
 * CDP transport — attach to a Chromium window that is already running.
 *
 * This is the preferred path for a Web Brain, and it exists because launching
 * our own browser is the wrong shape for the job:
 *
 *   - a launched browser starts with an empty profile, so the user signs in
 *     again on every fresh machine
 *   - a launched Chromium is exactly what anti-automation checks look for
 *   - the user may want to watch, interrupt or continue the conversation by
 *     hand, which requires the window to survive between CLI invocations
 *
 * Anything that speaks the DevTools protocol works here: a Chromium-based
 * desktop application, or the user's own Edge/Chrome started with
 * `--remote-debugging-port`. The transport itself makes no assumption about
 * which one it is — `probeChromiumEndpoint` reports what answered.
 *
 * Security posture is unchanged from the rest of the Core: we drive the
 * official UI, we never read cookies or tokens out of the attached profile,
 * and we never close a window we did not open.
 */
import { browserFailure } from "@agent2llm/core";
import {
  probeChromiumEndpoint,
  type BrowserLaunchOptions,
  type BrowserSelectors,
} from "./browser.js";
import { ChromiumPageTransport, hostOf, type ContextHandle, type PageLike } from "./chromium.js";
import { loadPlaywright } from "./playwright.js";

/**
 * A tab worth taking over: the browser's own startup page. Navigating the
 * user's existing tab away from whatever they were reading would be rude, so
 * only blank tabs are eligible for reuse.
 */
function isReusableBlank(url: string): boolean {
  return (
    url === "" ||
    url === "about:blank" ||
    url.startsWith("edge://newtab") ||
    url.startsWith("chrome://newtab") ||
    url.startsWith("devtools://")
  );
}

export class CdpBrowserTransport extends ChromiumPageTransport {
  readonly kind = "cdp";

  constructor(selectors: BrowserSelectors) {
    super(selectors);
  }

  protected async openContext(options: BrowserLaunchOptions): Promise<ContextHandle> {
    const endpoint = options.endpoint?.trim();
    if (!endpoint) {
      throw browserFailure(
        "The attach transport needs a DevTools endpoint, for example http://127.0.0.1:9222.",
        { retryable: false }
      );
    }

    // Ask the endpoint what it is before handing it to Playwright, which
    // reports one generic handshake error for every possible cause.
    const probe = await probeChromiumEndpoint(endpoint, {
      timeoutMs: options.timeoutMs ?? 2000,
    });
    if (!probe.reachable) {
      throw browserFailure(
        `Nothing answered at ${probe.endpoint} (${probe.reason ?? "no response"}). ` +
          "Start the window with a DevTools port first, then retry.",
        { retryable: false }
      );
    }

    const playwright = await loadPlaywright();
    let browser;
    try {
      browser = await playwright.chromium.connectOverCDP(probe.endpoint, {
        timeout: options.timeoutMs ?? 15_000,
      });
    } catch (error) {
      throw browserFailure(
        `${probe.endpoint} answered as "${probe.browser ?? "unknown"}" but the DevTools handshake failed.`,
        { cause: error, retryable: false }
      );
    }

    const context = browser.contexts()[0];
    if (!context) {
      throw browserFailure(`${probe.endpoint} exposed no browser context to drive.`, {
        retryable: false,
      });
    }
    return { context, browser };
  }

  protected override async selectPage(options: BrowserLaunchOptions): Promise<PageLike> {
    const pages = this.context!.pages();

    // Prefer a tab already on the target site: it carries the user's session,
    // so attaching does not trigger a second login.
    const target = options.targetUrl ? hostOf(options.targetUrl) : "";
    if (target) {
      const onTarget = pages.find((page) => hostOf(page.url()) === target);
      if (onTarget) return onTarget;
    }

    const blank = pages.find((page) => isReusableBlank(page.url()));
    if (blank) return blank;

    return pages.length > 0 ? pages[0]! : await this.context!.newPage();
  }

  protected override async releaseContext(): Promise<void> {
    // The window is the user's, not ours. Playwright's close() on a connected
    // browser ends our session; it does not own the process. The contract test
    // asserts that the page is still alive afterwards.
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
