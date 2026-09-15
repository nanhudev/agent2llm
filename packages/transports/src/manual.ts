import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir } from "@agent2llm/config";
import { browserFailure, timeoutError } from "@agent2llm/core";
import type { BrowserPageState, BrowserTransport } from "./browser.js";

/**
 * Manual transport.
 *
 * Real, not a stub: Agent2LLM writes the outbound control message to an
 * outbox file and waits for the user (or another tool) to drop the Brain's
 * reply in the inbox file. It is the fallback when Playwright is absent,
 * when a browser policy forbids automation, or when the user simply prefers
 * to drive their own browser.
 *
 *   agent2llm brain outbox show     -> read the text to paste
 *   agent2llm brain inbox  submit   -> hand the reply back
 */
const OUTBOX = "outbox.txt";
const INBOX = "inbox.txt";
const STATE = "state.json";

export interface ManualTransportLike extends BrowserTransport {
  outboxPath(): string;
  inboxPath(): string;
  submitReply(text: string): void;
}

export class ManualBrowserTransport implements BrowserTransport {
  readonly kind = "manual";

  private dir: string;
  private url = "";

  constructor(dir: string = path.join(getStateDir(), "manual-transport")) {
    this.dir = ensureDir(dir);
  }

  outboxPath(): string {
    return path.join(this.dir, OUTBOX);
  }

  inboxPath(): string {
    return path.join(this.dir, INBOX);
  }

  async launch(): Promise<void> {
    ensureDir(this.dir);
  }

  async open(url: string): Promise<void> {
    this.url = url;
    fs.writeFileSync(path.join(this.dir, STATE), JSON.stringify({ url }, null, 2), "utf8");
  }

  async state(): Promise<BrowserPageState> {
    const inbox = this.inboxPath();
    return {
      url: this.url,
      loggedIn: true,
      challenge: false,
      streaming: false,
      lastAssistantMessage: fs.existsSync(inbox) ? fs.readFileSync(inbox, "utf8") : "",
    };
  }

  async type(text: string): Promise<void> {
    fs.writeFileSync(this.outboxPath(), text, "utf8");
    // A new outbound message invalidates the previous reply.
    const inbox = this.inboxPath();
    if (fs.existsSync(inbox)) fs.rmSync(inbox, { force: true });
  }

  async submit(): Promise<void> {
    // No-op: the human performs the paste-and-send action.
  }

  async waitForReply(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    const inbox = this.inboxPath();
    for (;;) {
      if (options.signal?.aborted) throw browserFailure("Manual reply wait cancelled.", { retryable: false });
      if (fs.existsSync(inbox)) {
        const text = fs.readFileSync(inbox, "utf8").trim();
        if (text !== "") return text;
      }
      if (Date.now() > deadline) {
        throw timeoutError(
          `No reply was submitted to ${inbox} within ${Math.round(timeoutMs / 1000)}s.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  submitReply(text: string): void {
    fs.writeFileSync(this.inboxPath(), text, "utf8");
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}
