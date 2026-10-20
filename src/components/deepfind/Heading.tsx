import type { ReactNode } from 'react';

/** A heading whose level the caller picks, so the same block nests correctly on the run page and in the modal. */
export function Heading({ level, className, children }: { level: number; className?: string; children: ReactNode }) {
  const Tag = `h${Math.min(Math.max(level, 2), 6)}` as 'h2';
  return <Tag className={className}>{children}</Tag>;
}

/** Shortens long values inside accessible names. */
export function shortValue(value: unknown, max = 40): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
