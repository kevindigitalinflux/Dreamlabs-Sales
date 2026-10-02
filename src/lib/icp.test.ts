import { describe, expect, it } from 'vitest';
import { searchTextFromIcp } from './icp';

describe('searchTextFromIcp', () => {
  it('uses the name and the tidied summary, or just the name', () => {
    expect(searchTextFromIcp({ name: 'Property managers', summary: '  Run 20 to 200\n units ' })).toBe('Property managers: Run 20 to 200 units');
    expect(searchTextFromIcp({ name: 'Property managers', summary: null })).toBe('Property managers');
    expect(searchTextFromIcp({ name: 'Property managers', summary: '   ' })).toBe('Property managers');
  });
});
