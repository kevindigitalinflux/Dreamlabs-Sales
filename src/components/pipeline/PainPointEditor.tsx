import { useEffect, useState } from 'react';
import type { ChosenPainPoint } from '../../../supabase/functions/_shared/painPointPick';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';

interface Props {
  choice: ChosenPainPoint | null; points: string[]; loading: boolean; error: string | null;
  onSave: (text: string) => Promise<string | null>; review?: boolean;
}

/** Visible provenance and a labelled manual override; saving never silently rewrites reviewed email text. */
export function PainPointEditor({ choice, points, loading, error, onSave, review = false }: Props) {
  const [text, setText] = useState(choice?.pain_point ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => { setText(choice?.pain_point ?? ''); }, [choice?.pain_point]);
  async function save() {
    if (!text.trim()) return setMessage({ error: true, text: 'Enter a pain point first.' });
    setBusy(true); setMessage(null);
    try {
      const problem = await onSave(text.trim());
      setMessage({ error: !!problem, text: problem ?? 'Manual choice saved.' });
    } catch (error) {
      console.error('pain point editor: manual save failed');
      setMessage({ error: true, text: 'Could not save the pain point. Please try again.' });
    } finally { setBusy(false); }
  }
  if (loading) return <p role="status" className="text-sm text-muted">Loading pain point…</p>;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  return <section aria-label="Pain point" className="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-3">
    <p className="break-words text-sm font-semibold">{choice ? `Pain point: ${choice.pain_point}` : 'No pain point chosen yet'}</p>
    {choice && <p className="break-words text-xs text-muted">{choice.source === 'manual' ? 'Chosen by you' : `Chosen by AI because ${choice.reason}`}</p>}
    {review && <p className="text-xs text-muted">Saving a choice does not rewrite this email. Personalise again or edit the email before sending.</p>}
    <details>
      <summary className="min-h-11 cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-line">Change pain point</summary>
      <div className="flex min-w-0 flex-col gap-3 pt-2">
        <SelectField label="Customer profile pain point" value={String(points.indexOf(text))} disabled={busy}
          onChange={e => setText(points[Number(e.target.value)] ?? '')}>
          <option value="-1">Type your own</option>
          {points.map((point, index) => <option key={index} value={String(index)}>{point}</option>)}
        </SelectField>
        <Input label="Your pain point" value={text} maxLength={300} disabled={busy} onChange={e => setText(e.target.value)} />
        <Button variant="secondary" loading={busy} disabled={busy || !text.trim()} onClick={() => void save()}>Save manual choice</Button>
      </div>
    </details>
    {message && <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-danger' : 'text-muted'}`}>{message.text}</p>}
  </section>;
}
