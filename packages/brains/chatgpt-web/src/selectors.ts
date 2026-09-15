/**
 * ChatGPT DOM selectors, kept in one place so browser logic stays testable
 * against fixture HTML instead of a live page.
 *
 * These target the official ChatGPT web UI for normal user interaction.
 * They are version-sensitive by nature: `detect()` reports them as
 * `unverified` until a real session has been exercised.
 */
import type { BrowserSelectors } from "@agent2llm/transports";

export const CHATGPT_URLS = {
  base: "https://chatgpt.com",
  newChat: "https://chatgpt.com/",
  connectors: "https://chatgpt.com/#settings/Connectors",
} as const;

export const CHATGPT_SELECTORS: BrowserSelectors = {
  composer: "#prompt-textarea, div[contenteditable='true'][data-id='root'], textarea[data-id='root']",
  assistantMessage: "div[data-message-author-role='assistant'] .markdown, div[data-message-author-role='assistant']",
  streaming: "button[data-testid='stop-button'], div.result-streaming",
  challenge: "div[data-testid='challenge-form'], #cf-challenge-running, [data-testid='login-form']",
};

/** Heuristics used by `parseConversationUrl` and the doctor checks. */
export const CHATGPT_URL_PATTERNS = {
  conversation: /^https:\/\/chatgpt\.com\/(?:c|g\/[^\/]+)\/[A-Za-z0-9_-]+/,
  anyChat: /^https:\/\/chatgpt\.com\//,
} as const;

export function isConversationUrl(url: string): boolean {
  return CHATGPT_URL_PATTERNS.conversation.test(url);
}
