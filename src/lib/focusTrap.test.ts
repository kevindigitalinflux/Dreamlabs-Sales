import { describe, expect, it } from 'vitest';
import { trapTarget } from './focusTrap';

describe('trapTarget', () => {
  it('wraps Tab from the last control to the first', () => expect(trapTarget(3, 2, false)).toBe(0));
  it('wraps Shift+Tab from the first control to the last', () => expect(trapTarget(3, 0, true)).toBe(2));
  it('sends Shift+Tab from the dialog itself to the last control', () => expect(trapTarget(3, -1, true)).toBe(2));
  it('sends Tab from outside the list to the first control', () => expect(trapTarget(3, -1, false)).toBe(0));
  it('lets the browser move focus in the middle', () => {
    expect(trapTarget(3, 1, false)).toBeNull();
    expect(trapTarget(3, 1, true)).toBeNull();
  });
  it('keeps focus on the dialog when nothing is focusable', () => expect(trapTarget(0, -1, false)).toBe('container'));
  it('a single control traps both directions', () => {
    expect(trapTarget(1, 0, false)).toBe(0);
    expect(trapTarget(1, 0, true)).toBe(0);
  });
});
