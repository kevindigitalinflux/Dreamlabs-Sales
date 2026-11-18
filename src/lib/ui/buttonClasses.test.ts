import { describe, expect, it } from 'vitest';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const SIZES: ButtonSize[] = ['md', 'sm'];

describe('buttonClasses', () => {
  it('gives every button the shared shape, focus ring and reduced-motion rule, and never cyan', () => {
    for (const v of VARIANTS) for (const s of SIZES) {
      const c = buttonClasses(v, s);
      expect(c).toContain('rounded-control');
      expect(c).toContain('motion-reduce:transition-none');
      expect(c).toContain('focus-visible:outline-focus');
      expect(c).not.toContain('cyan');
    }
  });
  it('is 44px on phones and smaller from md up', () => {
    expect(buttonClasses('primary', 'md')).toContain('min-h-11');
    expect(buttonClasses('primary', 'md')).toContain('md:min-h-10');
    expect(buttonClasses('primary', 'sm')).toContain('min-h-11');
    expect(buttonClasses('primary', 'sm')).toContain('md:min-h-8');
  });
  it('gives only the primary button the gradient and glow', () => {
    const p = buttonClasses('primary', 'md');
    for (const part of ['from-violet', 'to-purple', 'text-on-accent', 'shadow-glow']) expect(p).toContain(part);
    for (const v of VARIANTS.filter((x) => x !== 'primary')) expect(buttonClasses(v, 'md')).not.toContain('shadow-glow');
  });
  it('makes the secondary button a transparent outline', () => {
    expect(buttonClasses('secondary', 'md')).toContain('border-line');
    expect(buttonClasses('secondary', 'md')).toContain('bg-transparent');
  });
});
