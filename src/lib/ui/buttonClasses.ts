export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-semibold transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 md:min-h-10 px-4 text-[15px]',
  sm: 'min-h-11 md:min-h-8 px-3 text-sm',
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-linear-to-br from-violet to-purple text-on-accent shadow-glow hover:brightness-110',
  secondary: 'border border-line bg-transparent text-offwhite hover:bg-surface',
  ghost: 'bg-transparent text-muted hover:bg-surface hover:text-offwhite',
  danger: 'border border-red-500/40 bg-red-500/15 text-danger-strong hover:bg-red-500/25',
};

/** Class string for the app's one button look: shape, focus ring, size and variant. Shared by Button and IconButton. */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize): string {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]}`;
}
