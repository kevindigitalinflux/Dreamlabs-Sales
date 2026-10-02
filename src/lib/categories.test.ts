import { describe, expect, it } from 'vitest';
import { UNCATEGORISED, categoryLabel, compareByCategory, distinctCategories, matchesCategory, normalizeCategory } from './categories';

describe('normalizeCategory', () => {
  it('trims, collapses spaces, and turns blank into null', () => {
    expect(normalizeCategory('  Property   managers ')).toBe('Property managers');
    expect(normalizeCategory('   ')).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory('x'.repeat(100))?.length).toBe(60);
  });
});

describe('categoryLabel', () => {
  it('puts the category first so it survives truncation', () => {
    expect(categoryLabel('Intro email', 'Property managers')).toBe('Property managers · Intro email');
    expect(categoryLabel('Intro email', null)).toBe('Intro email');
    expect(categoryLabel('Intro email', '  ')).toBe('Intro email');
  });
});

describe('compareByCategory', () => {
  it('groups categories A to Z (any case), then name, with uncategorised last', () => {
    const items = [
      { name: 'Zeta' }, { name: 'B', category: 'property managers' }, { name: 'A', category: 'Property Managers' },
      { name: 'C', category: 'Airbnb hosts' }, { name: 'Alpha' },
    ];
    expect([...items].sort(compareByCategory).map((i) => i.name)).toEqual(['C', 'A', 'B', 'Alpha', 'Zeta']);
  });
});

describe('distinctCategories / matchesCategory', () => {
  it('lists each category once, ignoring case and blanks', () => {
    expect(distinctCategories([{ category: 'Property managers' }, { category: 'property managers ' }, { category: null }, { category: 'Airbnb' }]))
      .toEqual(['Airbnb', 'Property managers']);
  });

  it('filters by all / uncategorised / a category (any case)', () => {
    expect(matchesCategory({ category: 'Airbnb' }, '')).toBe(true);
    expect(matchesCategory({ category: null }, UNCATEGORISED)).toBe(true);
    expect(matchesCategory({ category: 'Airbnb' }, UNCATEGORISED)).toBe(false);
    expect(matchesCategory({ category: 'airbnb' }, 'Airbnb')).toBe(true);
    expect(matchesCategory({ category: null }, 'Airbnb')).toBe(false);
  });
});
