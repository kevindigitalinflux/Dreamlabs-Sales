import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface FlatOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface GroupedOption {
  groupLabel: string;
  options: FlatOption[];
}

type ParsedOption = FlatOption | GroupedOption;

function isGroup(o: ParsedOption): o is GroupedOption {
  return 'groupLabel' in o;
}

/** Reads the same <option>/<optgroup> children a native <select> would accept,
 * so callers never need to change how they build their option list. */
function parseChildren(children: ReactNode): ParsedOption[] {
  const result: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const el = child as ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
      result.push({ value: String(el.props.value ?? ''), label: el.props.children, disabled: el.props.disabled });
    } else if (child.type === 'optgroup') {
      const el = child as ReactElement<{ label?: string; children?: ReactNode }>;
      const options: FlatOption[] = [];
      Children.forEach(el.props.children, (opt) => {
        if (isValidElement(opt) && opt.type === 'option') {
          const optEl = opt as ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
          options.push({ value: String(optEl.props.value ?? ''), label: optEl.props.children, disabled: optEl.props.disabled });
        }
      });
      result.push({ groupLabel: el.props.label ?? '', options });
    }
  });
  return result;
}

function flatten(parsed: ParsedOption[]): FlatOption[] {
  return parsed.flatMap((o) => (isGroup(o) ? o.options : [o]));
}

interface ListboxProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Fills its container's width (the default, matching a native select in a
   * form layout). Set false for an inline switcher that should size to its
   * own content instead — e.g. the top-bar pipeline/org switchers. */
  fullWidth?: boolean;
}

/**
 * Custom-rendered dropdown replacing a native <select> — browsers give no CSS
 * hook to restyle a native select's own open-option-list hover/selected colour
 * (it's rendered by the OS, not the page), so matching the app's brand there
 * requires rendering the option list ourselves. Accepts the exact same
 * <option>/<optgroup> children, `value`, and `onChange({target:{value}})`
 * shape a native select does, so every existing caller works unchanged.
 *
 * The open panel is portaled to document.body with position:fixed, computed
 * from the trigger's own bounding rect — never position:absolute inside the
 * normal document flow. A native select's dropdown renders in its own OS
 * layer and never affects page layout; an in-flow absolutely-positioned
 * panel does not extend a flex ancestor's *computed* height (that ignores
 * absolutely-positioned overflow) but DOES extend the page's real scrollable
 * height, so opening one near the bottom of a tall page left a gap below the
 * sidebar (its flex-stretched height no longer matched the now-taller
 * document). Portaling avoids the mismatch entirely.
 */
export function Listbox({ value, onChange, children, id, ariaLabel, disabled, className = '', fullWidth = true }: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);

  const parsed = parseChildren(children);
  const flat = flatten(parsed);
  const selected = flat.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flip above the trigger when there's not enough room below in the
    // viewport (fixed-position content, unlike absolute-in-flow, would
    // otherwise render partly or fully off-screen with no way to scroll to it).
    const PANEL_MAX_HEIGHT = 256;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow) {
      setCoords({ bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width });
    } else {
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // A scrolled ancestor would leave the portal's fixed-position panel
    // pinned to the wrong spot on screen — closing is simpler and safer
    // than tracking every scrollable ancestor to reposition live.
    function close() {
      setOpen(false);
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = flat.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    panelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function commit(v: string) {
    onChange({ target: { value: v } });
    setOpen(false);
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = flat[highlighted];
      if (opt && !opt.disabled) commit(opt.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className={`relative ${fullWidth ? 'w-full' : 'inline-block'}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        className={`flex min-h-11 ${fullWidth ? 'w-full' : ''} cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-surface py-2 pl-3 pr-3 text-left text-offwhite outline-none hover:border-violet/60 focus:border-violet disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && coords && createPortal(
        <ul
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          style={{
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            width: fullWidth ? coords.width : undefined,
            minWidth: fullWidth ? undefined : coords.width,
          }}
          className="fixed z-50 max-h-64 overflow-auto rounded-lg border border-line bg-card p-1 shadow-lg outline-none"
        >
          {parsed.map((o, gi) =>
            isGroup(o) ? (
              <Fragment key={`group-${gi}`}>
                <li role="presentation" className="px-2 pb-1 pt-2 text-xs font-semibold text-muted">{o.groupLabel}</li>
                {o.options.map((opt) => (
                  <ListboxOption
                    key={opt.value}
                    opt={opt}
                    selected={opt.value === value}
                    highlighted={flat.indexOf(opt) === highlighted}
                    onSelect={() => commit(opt.value)}
                    onHover={() => setHighlighted(flat.indexOf(opt))}
                  />
                ))}
              </Fragment>
            ) : (
              <ListboxOption
                key={o.value}
                opt={o}
                selected={o.value === value}
                highlighted={flat.indexOf(o) === highlighted}
                onSelect={() => commit(o.value)}
                onHover={() => setHighlighted(flat.indexOf(o))}
              />
            ),
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}

function ListboxOption({ opt, selected, highlighted, onSelect, onHover }: {
  opt: FlatOption; selected: boolean; highlighted: boolean; onSelect: () => void; onHover: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      aria-disabled={opt.disabled}
      onMouseEnter={onHover}
      onClick={() => !opt.disabled && onSelect()}
      className={`flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-sm ${
        opt.disabled ? 'cursor-not-allowed opacity-50' : ''
      } ${highlighted ? 'bg-violet/20 text-offwhite' : 'text-offwhite'} ${selected ? 'font-semibold' : ''}`}
    >
      <span className="truncate">{opt.label}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-violet" aria-hidden />}
    </li>
  );
}
