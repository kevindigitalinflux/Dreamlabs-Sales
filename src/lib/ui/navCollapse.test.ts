import { describe, expect, it, vi } from 'vitest';
import { NAV_COLLAPSE_KEY, readNavCollapsed, writeNavCollapsed } from './navCollapse';

const holding = (value: string | null) => ({ getItem: () => value });
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('navCollapse', () => {
  it('defaults to open when storage is missing, empty, junk or throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readNavCollapsed(null)).toBe(false);
    for (const value of [null, '0', '', 'true', '{']) expect(readNavCollapsed(holding(value))).toBe(false);
    expect(readNavCollapsed(throwing)).toBe(false);
  });
  it('is collapsed only for the exact stored value', () => {
    expect(readNavCollapsed(holding('1'))).toBe(true);
  });
  it('stores 1 or 0 under the key', () => {
    const setItem = vi.fn();
    writeNavCollapsed({ setItem }, true);
    writeNavCollapsed({ setItem }, false);
    expect(setItem.mock.calls).toEqual([[NAV_COLLAPSE_KEY, '1'], [NAV_COLLAPSE_KEY, '0']]);
  });
  it('never throws when storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => writeNavCollapsed(throwing, true)).not.toThrow();
    expect(() => writeNavCollapsed(null, true)).not.toThrow();
  });
});
