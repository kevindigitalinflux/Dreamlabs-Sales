import { useState } from 'react';
import { Frown, Meh, Smile } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { StepProgress } from '../ui/StepProgress';

interface DebriefWizardProps {
  onSubmit: (compiled: string, nextAction: { date: string | null; note: string | null }) => void;
  onCancel: () => void;
}

const TOTAL = 6;
const OUTCOMES = [
  { value: 'Positive', icon: Smile },
  { value: 'Neutral', icon: Meh },
  { value: 'Negative', icon: Frown },
] as const;

/** Guided call debrief: 6 questions, one per screen, compiled into a single note. */
export function DebriefWizard({ onSubmit, onCancel }: DebriefWizardProps) {
  const [step, setStep] = useState(1);
  const [outcome, setOutcome] = useState('');
  const [pain, setPain] = useState('');
  const [objections, setObjections] = useState('');
  const [promise, setPromise] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');
  const [other, setOther] = useState('');

  function submit() {
    const compiled = [
      `Call outcome: ${outcome || 'Not recorded'}`,
      pain && `Main pain point:\n${pain}`,
      objections && `Objections:\n${objections}`,
      promise && `Promised follow-up:\n${promise}`,
      (nextDate || nextNote) && `Next step${nextDate ? ` (${nextDate})` : ''}:\n${nextNote || '—'}`,
      other && `Other notes:\n${other}`,
    ].filter(Boolean).join('\n\n');
    onSubmit(compiled, { date: nextDate || null, note: nextNote || null });
  }

  return (
    <div className="flex flex-col gap-5">
      <StepProgress step={step} total={TOTAL} />

      {step === 1 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">How did the call go?</legend>
          <div className="flex gap-2">
            {OUTCOMES.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setOutcome(value); setStep(2); }}
                aria-pressed={outcome === value}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-semibold ${outcome === value ? 'border-cyan text-cyan' : 'border-line text-muted hover:text-offwhite'}`}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {value}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {step === 2 && <Textarea label="What was their main pain point?" value={pain} onChange={(e) => setPain(e.target.value)} placeholder="e.g. Losing leads because nobody follows up after quotes" />}
      {step === 3 && <Textarea label="Did they raise any objections?" value={objections} onChange={(e) => setObjections(e.target.value)} placeholder="e.g. Worried about cost; already tried an agency" />}
      {step === 4 && <Textarea label="What did you promise to follow up with?" value={promise} onChange={(e) => setPromise(e.target.value)} placeholder="e.g. Send the audit booking link by Friday" />}
      {step === 5 && (
        <div className="flex flex-col gap-3">
          <Input label="When is the next step?" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <Input label="What is the next step?" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. Call back to book the audit" />
        </div>
      )}
      {step === 6 && <Textarea label="Add any other notes (optional)" value={other} onChange={(e) => setOther(e.target.value)} />}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}>
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>
        {step > 1 && step < TOTAL && <Button onClick={() => setStep(step + 1)}>Next</Button>}
        {step === TOTAL && <Button onClick={submit}>Save debrief</Button>}
      </div>
    </div>
  );
}
