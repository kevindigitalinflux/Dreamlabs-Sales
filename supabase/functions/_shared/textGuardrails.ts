/**
 * Replaces em/en-dashes and spaced hyphens used as clause connectors with a
 * comma — a deterministic backstop for the "never use dashes" prompt
 * instruction, since models don't reliably follow style instructions under
 * all conditions. Only targets space-dash-space (any dash variant); a
 * hyphenated compound word like "well-known" has no surrounding spaces and
 * is left untouched. The dash must follow a word (a non-space character
 * before the space), so a "- " bullet at the start of a line, indented or
 * not, is never touched.
 */
export function stripAiPunctuation(text: string): string {
  return text.replace(/(?<=\S) [—–-] /g, ', ');
}
