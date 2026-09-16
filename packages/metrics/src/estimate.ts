/**
 * Character-count token estimation.
 *
 * Used only where a provider reports no usage and no better source exists.
 * The estimate is deliberately coarse and always labelled as one: an
 * approximate number that says what it is beats an exact-looking number
 * invented from a ratio.
 *
 * Rule: CJK characters count one each (they are roughly one token per
 * character in every mainstream tokenizer); other text counts one token per
 * four characters.
 */
const CJK_RANGES = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RANGES) ?? []).length;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}
