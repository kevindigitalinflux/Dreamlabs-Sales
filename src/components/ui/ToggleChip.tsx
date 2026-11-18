import type { ButtonHTMLAttributes, ReactNode } from 'react';

const BASE =
  'inline-flex min-h-11 md:min-h-10 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const OFF = 'border-line bg-raised text-muted hover:bg-surface hover:text-offwhite';
const ON: Record<'default' | 'attention', string> = {
  default: 'border-violet-line bg-violet-soft text-link',
  attention: 'border-attention bg-attention-soft text-attention',
};

interface ToggleChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** `attention` is for "problem" filters such as Overdue only. */
  tone?: 'default' | 'attention';
  children: ReactNode;
}

/**
 * On/off filter chip. The pressed state is shown by a tinted fill and coloured border, never by size, so turning one
 * on cannot move its neighbours.
 */
export function ToggleChip({ pressed, onPressedChange, tone = 'default', className = '', children, ...rest }: ToggleChipProps) {
  return (
    <button type="button" aria-pressed={pressed} onClick={() => onPressedChange(!pressed)} className={`${BASE} ${pressed ? ON[tone] : OFF} ${className}`} {...rest}>
      {children}
    </button>
  );
}
