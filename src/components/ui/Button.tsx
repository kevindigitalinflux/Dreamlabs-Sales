import type { ButtonHTMLAttributes } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from '../../lib/ui/buttonClasses';

// Primary's background is already violet, so its spinner stays on the
// button's own (light) text color for contrast; every other variant's own
// text color is muted/gray/red, so the spinner is pinned to the brand
// violet instead of blending in.
const SPINNER_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-current border-t-transparent',
  secondary: 'border-violet border-t-transparent',
  ghost: 'border-violet border-t-transparent',
  danger: 'border-violet border-t-transparent',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `md` (default) or the smaller `sm`. Both stay 44px tall on phones. */
  size?: ButtonSize;
  /** Shows a spinner before the label and disables the button while true. */
  loading?: boolean;
}

/** The app's button in its four variants and two sizes. Defaults to type="button". */
export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', loading = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClasses(variant, size)} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 motion-reduce:animate-none ${SPINNER_CLASSES[variant]}`}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
