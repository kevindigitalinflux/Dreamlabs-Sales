import { useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FloatingFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'className' | 'value' | 'id'> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  trailing?: ReactNode;
  error?: string;
}

/**
 * Floating-label auth field: the label rests inside the field shell at rest
 * and lifts to a small cyan semibold label on focus or once filled. Shared
 * by Login, ForgotPassword and ResetPassword.
 */
export function FloatingField({ id, label, value, onChange, trailing, error, onFocus, onBlur, ...rest }: FloatingFieldProps) {
  const [focused, setFocused] = useState(false);
  const floated = focused || value.length > 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className={`h-[52px] w-full rounded-[14px] border-[1.5px] bg-surface px-4 text-[15px] text-offwhite outline-none transition-colors ${
            floated ? 'pt-[18px]' : ''
          } ${focused ? 'border-cyan bg-card ring-4 ring-cyan/15' : 'border-line hover:border-muted/60'} ${trailing ? 'pr-11' : ''}`}
          {...rest}
        />
        <label
          htmlFor={id}
          className={`pointer-events-none absolute left-4 transition-all duration-150 ${
            floated ? 'top-[9px] text-[11px] font-semibold text-cyan' : 'top-1/2 -translate-y-1/2 text-[15px] text-muted'
          }`}
        >
          {label}
        </label>
        {trailing && <div className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
