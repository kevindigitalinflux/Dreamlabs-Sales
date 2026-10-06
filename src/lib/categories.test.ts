import { describe, expect, it } from 'vitest';
import { UNCATEGORISED, categoryLabel, compareByCategory, distinctCategories, groupByCategory, matchesCategory, normalizeCategory } from './categories';

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

describe('groupByCategory', () => {
  const items = [
    { name: 'Zeta' }, { name: 'Beta follow-up', category: 'property managers' }, { name: 'Alpha intro', category: 'Property Managers' },
    { name: 'Host intro', category: 'Airbnb hosts' }, { name: 'Another' },
  ];

  it('makes one group per category (any case), sorted A to Z, items sorted by name', () => {
    const groups = groupByCategory(items);
    expect(groups.map((g) => g.label)).toEqual(['Airbnb hosts', 'property managers', null]);
    expect(groups[1]!.items.map((i) => i.name)).toEqual(['Alpha intro', 'Beta follow-up']);
  });

  it('puts the uncategorised items last, as a group with a null label', () => {
    const groups = groupByCategory(items);
    expect(groups[groups.length - 1]).toEqual({ label: null, items: [{ name: 'Another' }, { name: 'Zeta' }] });
  });

  it('has no null group when everything is categorised, and just one when nothing is', () => {
    expect(groupByCategory([{ name: 'A', category: 'X' }]).map((g) => g.label)).toEqual(['X']);
    expect(groupByCategory([{ name: 'B' }, { name: 'A' }])).toEqual([{ label: null, items: [{ name: 'A' }, { name: 'B' }] }]);
    expect(groupByCategory([])).toEqual([]);
  });
});
