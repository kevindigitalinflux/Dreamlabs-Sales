import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from '../../lib/ui/buttonClasses';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also shown as the hover title. */
  label: string;
  icon: LucideIcon;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const SQUARE: Record<ButtonSize, string> = { md: 'min-w-11 md:min-w-10 !px-0', sm: 'min-w-11 md:min-w-8 !px-0' };

/** Square icon-only button with a required accessible name. Defaults to the quiet (ghost) look. */
export function IconButton({ label, icon: Icon, variant = 'ghost', size = 'md', className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={`${buttonClasses(variant, size)} ${SQUARE[size]} ${className}`} {...rest}>
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
