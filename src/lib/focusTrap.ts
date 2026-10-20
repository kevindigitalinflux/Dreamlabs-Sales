/** Selector for elements that can take keyboard focus inside a dialog. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab / Shift+Tab should send focus to keep it inside a dialog.
 * `count` is the number of focusable elements, `activeIndex` the index of the focused one (-1 when focus is on the
 * dialog itself or outside the list). Returns the index to focus (the caller prevents the default), the string
 * 'container' when there is nothing focusable, or null to let the browser move focus normally.
 */
export function trapTarget(count: number, activeIndex: number, shift: boolean): number | 'container' | null {
  if (count === 0) return 'container';
  if (shift) return activeIndex <= 0 ? count - 1 : null;
  return activeIndex < 0 || activeIndex === count - 1 ? 0 : null;
}
