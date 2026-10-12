import { Check, Minus } from 'lucide-react';
import type { StepLine } from '../../lib/knownPersonForm';

const TONE_TEXT: Record<StepLine['tone'], string> = {
  found: 'text-offwhite',
  muted: 'text-muted',
  error: 'text-danger',
};

/** Each lookup step on its own line: a tick when it found something, a dash otherwise, then what happened. */
export function LookupSteps({ steps }: { steps: StepLine[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="What the lookup tried">
      {steps.map((s) => (
        <li key={s.id} className={`flex items-start gap-2 text-xs ${TONE_TEXT[s.tone]}`}>
          {s.tone === 'found'
            ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-label="Found" />
            : <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-label="Nothing found" />}
          <span className="min-w-0"><span className="font-semibold">{s.label}:</span> {s.detail}</span>
        </li>
      ))}
    </ul>
  );
}
