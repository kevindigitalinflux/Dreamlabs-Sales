import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { nextTabIndex } from '../../lib/ui/tabKeys';

interface Tab { id: string; label: string; count?: number }

/** Text tab strip with a violet underline on the active tab. Arrow, Home and End keys move focus and select. */
export function Tabs({ tabs, value, onChange, label }: { tabs: Tab[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const next = nextTabIndex(index, e.key, tabs.length);
    if (next === index) return;
    e.preventDefault();
    const tab = tabs[next];
    if (tab) { onChange(tab.id); refs.current[next]?.focus(); }
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {tabs.map((tab, i) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-3 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${active ? 'border-violet-line text-link' : 'border-transparent text-muted hover:text-offwhite'}`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="rounded-full bg-surface px-2 text-xs">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Panel for one tab; renders its children only while active. */
export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return active ? <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="pt-3">{children}</div> : null;
}
