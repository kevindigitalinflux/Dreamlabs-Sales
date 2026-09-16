import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Listbox } from './Listbox';

const FIELD_CLASSES =
  'w-full rounded-lg border border-line bg-surface px-3 text-base text-offwhite outline-none placeholder:text-muted focus:border-cyan';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/** Labelled text input, 44px tall, cyan focus ring. */
export function Input({ label, error, className = '', ...rest }: InputProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <input id={id} className={`min-h-11 ${FIELD_CLASSES} ${className}`} {...rest} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

/** Labelled textarea — 18px font so iOS never auto-zooms (SPEC.md §12). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, className = '', ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <textarea ref={ref} id={id} className={`min-h-28 py-2 text-[18px] ${FIELD_CLASSES} ${className}`} {...rest} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
});

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Labelled dropdown, 44px tall — a custom-rendered listbox (not a native
 * <select>) so its open option list can carry the app's own violet
 * hover/selected styling, which a native select's OS-rendered popup can't be
 * given via CSS. Accepts the same <option>/<optgroup> children a native
 * select would. */
export function SelectField({ label, value, onChange, children, disabled, className = '' }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <Listbox id={id} value={value} onChange={onChange} disabled={disabled} className={`text-base ${className}`}>
        {children}
      </Listbox>
    </div>
  );
}
