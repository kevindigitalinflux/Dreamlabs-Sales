import type { ReactNode } from 'react';

/** Elevated card surface on the navy background. */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-card p-4 ${className}`}>{children}</div>;
}
