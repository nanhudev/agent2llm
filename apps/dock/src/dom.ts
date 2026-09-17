/**
 * Tiny DOM helpers for the dock's client script.
 *
 * `esc` is the whole XSS story: every server-shaped value reaches the page
 * through it (or through `textContent`, which needs no help). It is one
 * function because one function can be read.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

export function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page is missing #${id}`);
  return element;
}
