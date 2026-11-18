import type { ReactNode } from 'react';

const CARD_VARIANT = {
  raised: 'rounded-surface border border-line bg-raised p-4 shadow-raised',
  flat: 'rounded-nested bg-surface p-4',
} as const;

/** Card surface. `raised` (default) is the lifted surface with a line and soft shadow; `flat` is a nested block inside one. */
export function Card({ className = '', variant = 'raised', children }: { className?: string; variant?: keyof typeof CARD_VARIANT; children: ReactNode }) {
  return <div className={`${CARD_VARIANT[variant]} ${className}`}>{children}</div>;
}
