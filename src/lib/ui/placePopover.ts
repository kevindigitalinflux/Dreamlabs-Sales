export interface Box { top: number; bottom: number; left: number; right: number }
export interface Size { width: number; height: number }

/**
 * Where a floating panel goes relative to its anchor. Opens below, flips above when there is not enough room below and
 * more room above, lines up with the anchor's start or end edge, and is always kept `gap` px inside the viewport.
 * `maxHeight` is the room available on the chosen side, so a tall panel scrolls inside itself instead of leaving the screen.
 */
export function placePopover(anchor: Box, panel: Size, viewport: Size, align: 'start' | 'end', gap = 8): { top: number; left: number; maxHeight: number } {
  const roomBelow = viewport.height - anchor.bottom - gap * 2;
  const roomAbove = anchor.top - gap * 2;
  const below = panel.height <= roomBelow || roomBelow >= roomAbove;
  const maxHeight = Math.max(0, below ? roomBelow : roomAbove);
  const height = Math.min(panel.height, maxHeight);
  const top = below ? anchor.bottom + gap : Math.max(gap, anchor.top - gap - height);
  const wanted = align === 'end' ? anchor.right - panel.width : anchor.left;
  const left = Math.max(gap, Math.min(wanted, viewport.width - panel.width - gap));
  return { top, left, maxHeight };
}
