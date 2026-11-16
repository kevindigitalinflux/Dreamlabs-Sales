import { describe, expect, it } from 'vitest';
import { placePopover } from './placePopover';

const VIEW = { width: 1280, height: 720 };
const PANEL = { width: 320, height: 200 };

describe('placePopover', () => {
  it('opens below and lines up right edges when aligned to the end', () => {
    expect(placePopover({ top: 10, bottom: 50, left: 900, right: 1000 }, PANEL, VIEW, 'end')).toMatchObject({ top: 58, left: 680 });
  });
  it('lines up left edges when aligned to the start', () => {
    expect(placePopover({ top: 10, bottom: 50, left: 900, right: 1000 }, PANEL, VIEW, 'start').left).toBe(900);
  });
  it('flips above when there is no room below', () => {
    expect(placePopover({ top: 650, bottom: 690, left: 900, right: 1000 }, PANEL, VIEW, 'end').top).toBe(650 - 8 - 200);
  });
  it('clamps to the right edge', () => {
    expect(placePopover({ top: 10, bottom: 50, left: 1200, right: 1260 }, PANEL, VIEW, 'start').left).toBe(1280 - 320 - 8);
  });
  it('never goes off the left edge on a narrow screen', () => {
    expect(placePopover({ top: 10, bottom: 50, left: 10, right: 60 }, PANEL, { width: 400, height: 700 }, 'end').left).toBe(8);
  });
  it('limits a too-tall panel to the roomier side and keeps it on screen', () => {
    const placed = placePopover({ top: 100, bottom: 140, left: 900, right: 1000 }, { width: 320, height: 900 }, VIEW, 'end');
    expect(placed.top).toBe(148);
    expect(placed.maxHeight).toBe(720 - 140 - 16);
    expect(placed.top).toBeGreaterThanOrEqual(8);
  });
  it('gives a panel that fits at least its own height', () => {
    expect(placePopover({ top: 10, bottom: 50, left: 900, right: 1000 }, PANEL, VIEW, 'end').maxHeight).toBeGreaterThanOrEqual(200);
  });
});
