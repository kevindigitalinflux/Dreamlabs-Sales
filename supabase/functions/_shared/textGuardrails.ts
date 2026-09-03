/**
 * Replaces em/en-dashes and spaced hyphens used as clause connectors with a
 * comma — a deterministic backstop for the "never use dashes" prompt
 * instruction, since models don't reliably follow style instructions under
 * all conditions. Only targets space-dash-space (any dash variant); a
 * hyphenated compound word like "well-known" has no surrounding spaces and
 * is left untouched.
 */
export function stripAiPunctuation(text: string): string {
  return text.replace(/ [—–-] /g, ', ');
}
