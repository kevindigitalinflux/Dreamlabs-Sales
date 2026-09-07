// src/pages/Unsubscribe.tsx
import { useState } from 'react';
import { useParams } from 'react-router';
import { MailX, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

/** Public, unauthenticated unsubscribe confirmation page — reached via a link in an outreach email. */
export function Unsubscribe() {
  const { leadId } = useParams<{ leadId: string }>();
  const [state, setState] = useState<'confirm' | 'busy' | 'done' | 'error'>('confirm');
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!leadId) return;
    setState('busy');
    const { data, error: err } = await supabase.functions.invoke('unsubscribe', { body: { lead_id: leadId } });
    if (err) { setState('error'); setError(err.message); return; }
    const result = data as { ok?: boolean; business_name?: string; error?: string };
    if (result.error) { setState('error'); setError(result.error); return; }
    setBusinessName(result.business_name ?? null);
    setState('done');
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <Card>
        <div className="flex flex-col items-center gap-4 p-2">
          {state === 'done' ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden />
              <p className="text-lg font-bold">You've been unsubscribed</p>
              <p className="text-sm text-muted">
                {businessName ? `You won't hear from ${businessName} again.` : "You won't receive further emails from us."}
              </p>
            </>
          ) : (
            <>
              <MailX className="h-10 w-10 text-cyan" aria-hidden />
              <p className="text-lg font-bold">Stop future emails?</p>
              <p className="text-sm text-muted">Confirm below and we'll remove you from any further outreach.</p>
              {state === 'error' && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <Button onClick={() => void handleConfirm()} disabled={state === 'busy'}>
                {state === 'busy' ? 'Unsubscribing…' : 'Confirm — stop future emails'}
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
