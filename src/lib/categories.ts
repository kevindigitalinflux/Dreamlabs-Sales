/** Filter value meaning "only items with no category". */
export const UNCATEGORISED = '__none__';

const MAX_CATEGORY_LENGTH = 60;

/** Tidies a typed category: trims, collapses runs of spaces, caps the length; blank becomes null. */
export function normalizeCategory(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_LENGTH).trim();
  return text === '' ? null : text;
}

/**
 * How an item reads in a dropdown: category first, so it is still visible when a long
 * name gets truncated, e.g. "Property managers · Intro email".
 */
export function categoryLabel(name: string, category: string | null | undefined): string {
  const cat = normalizeCategory(category);
  return cat ? `${cat} · ${name}` : name;
}

/**
 * Sort order for pickers: categorised items grouped together (A to Z by category, then by
 * name), uncategorised ones after. Case-insensitive, so "property managers" and
 * "Property managers" sort as one group.
 */
export function compareByCategory(
  a: { name: string; category?: string | null },
  b: { name: string; category?: string | null },
): number {
  const ca = normalizeCategory(a.category);
  const cb = normalizeCategory(b.category);
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  if (ca && cb) {
    const byCategory = ca.localeCompare(cb, undefined, { sensitivity: 'base' });
    if (byCategory !== 0) return byCategory;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** The distinct categories in use (case-insensitive; keeps the first spelling seen), A to Z. */
export function distinctCategories(items: { category?: string | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const cat = normalizeCategory(item.category);
    if (cat && !seen.has(cat.toLowerCase())) seen.set(cat.toLowerCase(), cat);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Whether an item passes a category filter: '' = everything, UNCATEGORISED = only uncategorised, else that category. */
export function matchesCategory(item: { category?: string | null }, filter: string): boolean {
  if (filter === '') return true;
  const cat = normalizeCategory(item.category);
  if (filter === UNCATEGORISED) return cat === null;
  return cat !== null && cat.toLowerCase() === filter.toLowerCase();
}

/** A run of items under one category heading; `label` null means the uncategorised ones. */
export interface CategoryGroup<T> { label: string | null; items: T[] }

/**
 * Splits items into one group per category (A to Z, case-insensitive, keeping the first
 * spelling seen), each sorted by name, with the uncategorised items last as a group whose
 * label is null. Used by every template/sequence picker so a long list reads as a few
 * headed sections instead of one wall of names.
 */
export function groupByCategory<T extends { name: string; category?: string | null }>(items: T[]): CategoryGroup<T>[] {
  const byCategory = new Map<string, CategoryGroup<T>>();
  const uncategorised: T[] = [];
  for (const item of items) {
    const cat = normalizeCategory(item.category);
    if (!cat) { uncategorised.push(item); continue; }
    const key = cat.toLowerCase();
    if (!byCategory.has(key)) byCategory.set(key, { label: cat, items: [] });
    byCategory.get(key)!.items.push(item);
  }
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const groups = [...byCategory.values()]
    .sort((a, b) => a.label!.localeCompare(b.label!, undefined, { sensitivity: 'base' }))
    .map((g) => ({ ...g, items: [...g.items].sort(byName) }));
  if (uncategorised.length > 0) groups.push({ label: null, items: uncategorised.sort(byName) });
  return groups;
}
