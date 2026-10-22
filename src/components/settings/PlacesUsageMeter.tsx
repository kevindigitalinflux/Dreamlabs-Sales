import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { parsePlacesSnapshot, savePlacesLimit, type PlacesSnapshot } from '../../lib/placesSettings';

/** Monthly Google search usage; safe to render before its migration is installed. */
export function PlacesUsageMeter({ orgId, admin }: { orgId: string; admin: boolean }) {
  const [snapshot, setSnapshot] = useState<PlacesSnapshot | null>(null);
  const [limit, setLimit] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let initial = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('places_snapshot', { p_org: orgId });
        if (!active) return;
        const parsed = error ? null : parsePlacesSnapshot(data);
        setSnapshot(parsed);
        if (parsed && initial) { setLimit(String(parsed.limit)); initial = false; }
      } catch { if (active) setSnapshot(null); console.warn('Google Places meter unavailable'); }
      finally { if (active) setLoading(false); }
    };
    void load();
    // Poll only while visible; no new realtime publication is required.
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    return () => { active = false; clearInterval(interval); };
  }, [orgId]);
  async function save() {
    if (!admin || !snapshot || limit.trim() === '') return;
    setBusy(true); setMessage('');
    const value = Number(limit);
    const ok = await savePlacesLimit(supabase, orgId, value);
    setMessage(ok ? 'Monthly limit saved.' : 'Could not save. Enter a whole number from 0 to 100,000 and try again.');
    if (ok) setSnapshot({ ...snapshot, limit: value });
    setBusy(false);
  }
  if (loading) return <p className="text-sm text-muted" role="status">Loading Google search usage…</p>;
  if (!snapshot) return <p className="text-sm text-muted">Google search usage is unavailable. The monthly limit check must be ready before searches can run.</p>;
  return <div className="space-y-2 text-sm">
    <p>Google searches this month: {snapshot.used} of {snapshot.limit}. Resets {new Date(snapshot.resets_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'America/Los_Angeles' })}.</p>
    <p className="text-muted">Organisations using the shared key also share a separate limit of 900 searches. Your own Google billing account may serve other projects.</p>
    {admin && <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">Monthly Google search limit
        <input className="rounded border border-border bg-surface p-2" type="number" min="0" max="100000" step="1" value={limit} onChange={e => setLimit(e.target.value)} disabled={busy} />
      </label>
      <button className="rounded border border-border px-3 py-2 focus-visible:outline-2" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save limit'}</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
