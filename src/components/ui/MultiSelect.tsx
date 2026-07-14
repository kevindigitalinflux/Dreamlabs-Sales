import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

/** Checkbox dropdown for multi-value filters. Button shows a count when active. */
export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${selected.length > 0 ? 'border-cyan text-offwhite' : 'border-line text-muted'}`}
      >
        {label}{selected.length > 0 ? ` (${selected.length})` : ''}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 flex max-h-64 min-w-48 flex-col overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-xl">
          {options.map((opt) => (
            <label key={opt.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className="h-4 w-4 accent-violet-500" />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
