/**
 * Case-insensitive "close enough" name match: true if either name contains
 * the other. Used to guard against attaching a company-registry result to
 * the wrong lead when a free-text search returns an unrelated top result.
 */
export function isFuzzyNameMatch(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (!normA || !normB) return false;
  return normA.includes(normB) || normB.includes(normA);
}
