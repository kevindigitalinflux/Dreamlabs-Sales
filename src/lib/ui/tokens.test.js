import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');

const block = (start) => {
  const from = css.indexOf(start);
  return css.slice(from, css.indexOf('\n}', from));
};
const theme = block('@theme {');
const dark = block(':root[data-theme="dark"] {');

describe('theme tokens', () => {
  it('defines every Aurora token in the base theme', () => {
    for (const name of ['--color-raised', '--color-link', '--color-attention', '--color-attention-soft', '--color-focus', '--color-nav-active', '--shadow-raised', '--shadow-glow', '--radius-control', '--radius-surface', '--radius-nested']) {
      expect(theme, name).toContain(`${name}:`);
    }
  });
  it('redefines the per-theme tokens for dark', () => {
    for (const name of ['--color-raised', '--color-link', '--color-attention', '--color-attention-soft', '--color-focus', '--shadow-raised']) {
      expect(dark, name).toContain(`${name}:`);
    }
  });
  it('keeps the menu tokens locked across themes', () => {
    expect(dark).not.toContain('--color-nav-');
  });
  it('pins the three corner sizes', () => {
    expect(theme).toContain('--radius-control: 14px');
    expect(theme).toContain('--radius-surface: 16px');
    expect(theme).toContain('--radius-nested: 12px');
  });
});
