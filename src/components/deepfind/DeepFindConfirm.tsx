import { Input } from '../ui/Input';
import { useState } from 'react';
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

/** What Deep find will do and the editable credit caps, shown before it starts. */
export function DeepFindConfirm({ leadCount, hunterCap, aiCap, onHunterCap, onAiCap, capError, effort = 'medium', onEffort }: DeepFindConfirmProps) {
  const [allowance, setAllowance] = useState<HunterAllowance | null>(null);
  const totals = effort === 'custom' ? { hunter: Number(hunterCap) || 0, ai: Number(aiCap) || 0, firecrawl: Math.min(leadCount, 100), scrapes: Math.min(leadCount, 100) } : effortTotals(effort, leadCount);
  const hunterLeft = hunterAllowanceLeft(allowance);
  const hunterTotal = hunterLeft === null ? totals.hunter : Math.min(totals.hunter, hunterLeft);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>Deep find searches {leadCount === 1 ? 'this lead' : `${leadCount} leads`} in the background. For each one it:</p>
      <ul className="ml-5 list-disc text-muted">
        <li>looks for the company&apos;s other website and email domains</li>
        <li>matches Companies House records, adds active officers and reads the company&apos;s own pages</li>
        <li>tries the free browser scraper and email checker, including common email guesses</li>
        {effort !== 'low' && <li>uses Hunter, AI and Firecrawl when the selected effort allows deeper work</li>}
        {(effort === 'high' || effort === 'extra_high' || effort === 'custom') && <li>checks Google Places for missing website and phone, and Apollo for decision makers and company phone</li>}
      </ul>
      <p className="text-muted">
        People it finds on the company&apos;s confirmed domains are added as contacts with their source shown. They are never emailed and never added to
        follow-up sequences until you switch them on. People found only on a domain it could not confirm, or named only by the web search or the website, are listed for you to check.
      </p>
      <p className="text-muted">Confirmed details fill blank fields only. Every automatic change has Undo in the results. Other details stay suggestions with Add or Dismiss.</p>
      <fieldset className="min-w-0">
        <legend className="mb-2 font-semibold">How much effort?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(EFFORT_LEVELS) as Exclude<Effort, 'custom'>[]).map(value => <label key={value} className="min-w-0 cursor-pointer rounded-lg border border-line p-3 focus-within:outline-2 focus-within:outline-violet">
            <input type="radio" name="deep-find-effort" value={value} checked={effort === value} onChange={() => onEffort?.(value)} className="mr-2" />
            <span className="font-semibold">{EFFORT_LEVELS[value].label}{value === 'medium' ? ' (default)' : ''}</span>
            <span className="mt-1 block">{EFFORT_LEVELS[value].explanation}</span>
          </label>)}
        </div>
      </fieldset>
      <button type="button" aria-pressed={effort === 'custom'} className="self-start underline focus-visible:outline-2 focus-visible:outline-violet" onClick={() => onEffort?.('custom')}>Custom</button>
      <p role="status">For {leadCount} {leadCount === 1 ? 'lead' : 'leads'}: up to {hunterTotal} Hunter credits, {totals.ai} AI calls, {totals.firecrawl} Firecrawl pages, {totals.scrapes} browser scrapes, and our email checker (free).</p>
      <HunterAllowanceLine requested={totals.hunter} onAllowance={setAllowance} />
      {effort === 'custom' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label={`Hunter credits (max ${DEEP_FIND_CAP_LIMITS.hunter})`} inputMode="numeric" value={hunterCap} onChange={(e) => onHunterCap(e.target.value)} />
        <Input label={`AI calls (max ${DEEP_FIND_CAP_LIMITS.ai})`} inputMode="numeric" value={aiCap} onChange={(e) => onAiCap(e.target.value)} />
      </div>}
      <p className="text-xs">Hunter uses real monthly credits on your Hunter plan. AI uses your Gemini key, with a small cost and a few thousand tokens per call. Firecrawl uses your Firecrawl credits. Browser scrapes and email checks are free, within daily worker limits: 100 scrapes and 150 checks per organisation.</p>
      <p className="text-xs">Firecrawl is limited to 100 pages per organisation per day. These are upper bounds shared across runs. Missing keys or exhausted allowances skip those steps; remaining daily usage can reduce these totals.</p>
      <p className="text-xs text-muted">The caps cover the whole run. Each Hunter search uses about one Hunter credit. When a cap is reached, Deep find stops using that service and says so.</p>
      <p className="text-xs text-muted">The limits above cover Hunter and AI calls. Google Places is capped at 300 business lookups and Apollo company phone at 100 organisation enrichments per organisation per day, shared across runs. They use your configured provider accounts. Apollo decision-maker search does not reveal personal emails or phones. Phone lookups stop when a phone is already saved or Places supplies one.</p>
      {capError && <p role="alert" className="text-sm text-danger">{capError}</p>}
    </div>
  );
}
