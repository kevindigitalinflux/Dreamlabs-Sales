import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

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
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
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
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
});

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

/** Labelled native select, 44px tall. */
export function SelectField({ label, children, className = '', ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <select id={id} className={`min-h-11 ${FIELD_CLASSES} ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
}
