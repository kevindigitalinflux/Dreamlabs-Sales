import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tabKeys';

describe('nextTabIndex', () => {
  it('moves right and wraps', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
  });
  it('moves left and wraps', () => {
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
  });
  it('jumps with Home and End', () => {
    expect(nextTabIndex(1, 'Home', 3)).toBe(0);
    expect(nextTabIndex(1, 'End', 3)).toBe(2);
  });
  it('ignores other keys and an empty strip', () => {
    expect(nextTabIndex(1, 'a', 3)).toBe(1);
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBe(0);
  });
});
