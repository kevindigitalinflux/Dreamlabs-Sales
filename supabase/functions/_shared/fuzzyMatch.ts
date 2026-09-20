/**
 * Case-insensitive "close enough" name match: true if the shorter name's
 * words appear as a contiguous run within the longer name's words. Used to
 * guard against attaching a company-registry result to the wrong lead when
 * a free-text search returns an unrelated top result.
 *
 * Word-boundary (not raw substring) matching deliberately: a plain
 * `.includes()` check would let "Bloom" match "BLOOMBERG L.P." — they share
 * no word, just a prefix. Tokenizing first means "bloom" is compared as its
 * own word against "bloomberg", "l", "p" and correctly finds no match.
 */
export function isFuzzyNameMatch(a: string, b: string): boolean {
  const tokenize = (s: string) => s.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    if (shorter.every((tok, j) => longer[i + j] === tok)) return true;
  }
  return false;
}
