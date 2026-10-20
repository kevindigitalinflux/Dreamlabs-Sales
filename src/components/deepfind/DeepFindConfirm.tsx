import { Input } from '../ui/Input';
import { useState, type ReactNode } from 'react';
import { Check, Globe, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { HunterAllowance } from '../../lib/deepFind';
import { DEEP_FIND_CAP_LIMITS } from '../../lib/deepFindView';
import { HunterAllowanceLine } from './HunterAllowanceLine';
import { EFFORT_LEVELS, effortTotals, hunterAllowanceLeft, type Effort } from '../../../supabase/functions/_shared/deepFindEffort';

interface DeepFindConfirmProps {
  leadCount: number;
  hunterCap: string;
  aiCap: string;
  onHunterCap: (value: string) => void;
  onAiCap: (value: string) => void;
  capError: string | null;
  effort?: Effort;
  onEffort?: (value: Effort) => void;
}

const EFFORT_COPY: Record<Exclude<Effort, 'custom'>, { line: string; best: string }> = {
  low: { line: 'Free steps only. No paid credits.', best: 'a first pass or large lists' },
  medium: { line: 'Free steps first, then goes deeper only when an email or decision maker is missing.', best: 'most lists' },
  high: { line: 'Goes deeper when email, decision maker or website is missing. Adds web proof, Apollo and LinkedIn searches.', best: 'leads worth a closer look' },
  extra_high: { line: 'Tries every step, even when details are complete.', best: 'a few high-value leads' },
};

function SpendChip({ icon, label, n }: { icon: ReactNode; label: string; n: number }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold">{icon}{label} {n}</span>;
}

/** What Deep find will do and the editable credit caps, shown before it starts. */
export function DeepFindConfirm({ leadCount, hunterCap, aiCap, onHunterCap, onAiCap, capError, effort = 'medium', onEffort }: DeepFindConfirmProps) {
  const [allowance, setAllowance] = useState<HunterAllowance | null>(null);
  const totals = effort === 'custom' ? { hunter: Number(hunterCap) || 0, ai: Number(aiCap) || 0, firecrawl: Math.min(leadCount, 100), scrapes: Math.min(leadCount, 100) } : effortTotals(effort, leadCount);
  const hunterLeft = hunterAllowanceLeft(allowance);
  const hunterTotal = hunterLeft === null ? totals.hunter : Math.min(totals.hunter, hunterLeft);
  return (
    <div className="flex flex-col gap-4 text-sm text-offwhite">
      <p className="text-[15px]">Deep find searches {leadCount === 1 ? 'this lead' : `${leadCount} leads`} in the background. Choose how hard it should try.</p>
      <fieldset className="min-w-0">
        <legend className="mb-2 font-heading text-base font-bold">How much effort?</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(EFFORT_LEVELS) as Exclude<Effort, 'custom'>[]).map(value => {
            const level = EFFORT_LEVELS[value];
            const selected = effort === value;
            return <label key={value} className={`relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border-2 p-3.5 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-violet motion-reduce:transition-none ${selected ? 'border-violet bg-violet/10' : 'border-line bg-card hover:border-violet/50'}`}>
              <input type="radio" name="deep-find-effort" value={value} checked={selected} onChange={() => onEffort?.(value)} className="sr-only" />
              <span className="flex items-center gap-2">
                <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-violet bg-violet text-on-accent' : 'border-offwhite/50'}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
                <span className="font-heading text-base font-bold">{level.label}{value === 'medium' ? ' (default)' : ''}</span>
                {value === 'medium' && <span className="ml-auto rounded-full bg-violet px-2 py-0.5 text-xs font-semibold text-on-accent">Recommended</span>}
              </span>
              <span className="block">{EFFORT_COPY[value].line}</span>
              <span className="flex flex-wrap gap-1.5">
                <SpendChip icon={<Search size={12} aria-hidden />} label="Hunter" n={level.hunter} />
                <SpendChip icon={<Sparkles size={12} aria-hidden />} label="AI" n={level.ai} />
                <SpendChip icon={<Globe size={12} aria-hidden />} label="Firecrawl" n={level.firecrawl} />
                <span className="self-center text-xs text-offwhite/80">per lead, at most</span>
              </span>
              <span className="block text-[13px]"><span className="font-semibold">Best for:</span> {EFFORT_COPY[value].best}</span>
            </label>;
          })}
        </div>
      </fieldset>
      <div className="rounded-xl border-2 border-cyan/60 bg-cyan/10 p-3.5">
        <p role="status" className="font-semibold">For {leadCount} {leadCount === 1 ? 'lead' : 'leads'}: up to {hunterTotal} Hunter credits, {totals.ai} AI calls, {totals.firecrawl} Firecrawl pages, {totals.scrapes} browser scrapes, and our email checker (free).</p>
      </div>
      <HunterAllowanceLine requested={totals.hunter} onAllowance={setAllowance} />
      <button type="button" aria-pressed={effort === 'custom'} className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-[13px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-violet ${effort === 'custom' ? 'font-bold' : ''}`} onClick={() => onEffort?.('custom')}><SlidersHorizontal size={14} aria-hidden />Custom</button>
      {effort === 'custom' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label={`Hunter credits (max ${DEEP_FIND_CAP_LIMITS.hunter})`} inputMode="numeric" value={hunterCap} onChange={(e) => onHunterCap(e.target.value)} />
        <Input label={`AI calls (max ${DEEP_FIND_CAP_LIMITS.ai})`} inputMode="numeric" value={aiCap} onChange={(e) => onAiCap(e.target.value)} />
      </div>}
      {capError && <p role="alert" className="text-sm font-semibold text-danger">{capError}</p>}
      <details className="rounded-xl border border-line bg-surface/50 p-3">
        <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-violet">What Deep find does and what it costs</summary>
        <div className="mt-3 flex flex-col gap-3 text-[13px] leading-relaxed">
          <p>For each lead it:</p>
          <ul className="ml-5 list-disc">
            <li>looks for the company&apos;s other website and email domains</li>
            <li>matches Companies House records, adds active officers and reads the company&apos;s own pages</li>
            <li>tries the free browser scraper and email checker, including common email guesses</li>
            {effort !== 'low' && <li>uses Hunter, AI and Firecrawl when the selected effort allows deeper work</li>}
            {(effort === 'high' || effort === 'extra_high' || effort === 'custom') && <li>checks Google Places for missing website and phone, and Apollo for decision makers and company phone</li>}
          </ul>
          <p>People it finds on the company&apos;s confirmed domains are added as contacts with their source shown. They are never emailed and never added to follow-up sequences until you switch them on. People found only on a domain it could not confirm, or named only by the web search or the website, are listed for you to check.</p>
          <p>Confirmed details fill blank fields only. Every automatic change has Undo in the results. Other details stay suggestions with Add or Dismiss.</p>
          <p>Hunter uses real monthly credits on your Hunter plan. AI uses your Gemini key, with a small cost and a few thousand tokens per call. Firecrawl uses your Firecrawl credits. Browser scrapes and email checks are free, within daily worker limits: 100 scrapes and 150 checks per organisation.</p>
          <p>Firecrawl is limited to 100 pages per organisation per day. These are upper bounds shared across runs. Missing keys or exhausted allowances skip those steps; remaining daily usage can reduce these totals.</p>
          <p>The caps cover the whole run. Each Hunter search uses about one Hunter credit. When a cap is reached, Deep find stops using that service and says so.</p>
          <p>The limits above cover Hunter and AI calls. Google Places is capped at 300 business lookups and Apollo company phone at 100 organisation enrichments per organisation per day, shared across runs. They use your configured provider accounts. Apollo decision-maker search does not reveal personal emails or phones. Phone lookups stop when a phone is already saved or Places supplies one.</p>
        </div>
      </details>
    </div>
  );
}
