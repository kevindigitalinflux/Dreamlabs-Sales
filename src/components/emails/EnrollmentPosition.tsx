import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EmailSequence } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { useStepOptions } from './StepOptions';

/** Manually move an enrolled lead within its sequence: pick the step it is up to, or nudge it one step. */
export function EnrollmentPosition({ sequence, currentStep, busy, onMove }: {
  sequence: EmailSequence;
  currentStep: number;
  busy: boolean;
  onMove: (step: number, immediate: boolean) => void;
}) {
  const [immediate, setImmediate] = useState(false);
  const options = useStepOptions(sequence.steps);
  const total = sequence.steps.length;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <SelectField label="Next step to draft" value={String(currentStep)} onChange={(e) => onMove(Number(e.target.value), immediate)} disabled={busy}>
        {options}
      </SelectField>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy || currentStep <= 1} onClick={() => onMove(currentStep - 1, immediate)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />Back a step
        </Button>
        <Button variant="secondary" disabled={busy || currentStep >= total} onClick={() => onMove(currentStep + 1, immediate)}>
          Skip to next step<ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
        Draft the chosen step straight away (otherwise it waits that step's usual days)
      </label>
    </div>
  );
}
