import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-violet text-on-accent hover:bg-violet/85',
  secondary: 'border border-line bg-surface text-offwhite hover:bg-surface/70',
  ghost: 'bg-transparent text-muted hover:bg-surface/60 hover:text-offwhite',
  danger: 'border border-red-500/40 bg-red-500/15 text-danger hover:bg-red-500/25',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner before the label and disables the button while true. */
  loading?: boolean;
}

/** 44px-minimum button in the four app variants. Defaults to type="button". */
export function Button({ variant = 'primary', className = '', type = 'button', loading = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
