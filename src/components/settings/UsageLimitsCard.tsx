import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useUsage } from '../../hooks/useUsage';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import {
  MAX_ORG_LIMIT, parseLimitInput, USAGE_DEFAULTS, USAGE_TEXT, usageState, type UsageResource,
} from '../../../supabase/functions/_shared/usageRules';

type Saving = { resource: UsageResource; kind: 'save' | 'reset' } | null;

/** Drafts without one resource, without mutating the previous object. */
function without(drafts: Partial<Record<UsageResource, string>>, resource: UsageResource) {
  const rest = { ...drafts };
  delete rest[resource];
  return rest;
}

/**
 * Per-organisation daily limits for the shared lookup worker. Everyone in the organisation can see them; only an
 * organisation admin can change them (RLS is the real gate). The shared worker-wide allowance always wins, whatever is
 * typed here.
 */
export function UsageLimitsCard({ orgId, isOrgAdmin }: { orgId: string; isOrgAdmin: boolean }) {
  const { rows, loading, error, reload } = useUsage(orgId);
  const [drafts, setDrafts] = useState<Partial<Record<UsageResource, string>>>({});
  const [saving, setSaving] = useState<Saving>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setDrafts({}); setMessage(null); }, [orgId]);

  async function save(resource: UsageResource) {
    const text = drafts[resource];
    if (text === undefined) return;
    const row = rows.find((r) => r.resource === resource);
    if (row && text.trim() === String(row.limit)) { setDrafts((d) => without(d, resource)); return; }
    const value = parseLimitInput(text);
    if (value === null) {
      setMessage({ ok: false, text: `Enter a whole number from 0 to ${MAX_ORG_LIMIT} for ${USAGE_TEXT[resource].label.toLowerCase()}.` });
      return;
    }
    setSaving({ resource, kind: 'save' });
    const { error: err } = await supabase.from('usage_limits').upsert({ org_id: orgId, resource, daily_limit: value }, { onConflict: 'org_id,resource' });
    setSaving(null);
    if (err) {
      console.error('usage limit save failed:', err.message);
      setMessage({ ok: false, text: 'Could not save that limit. Only an organisation admin can change limits.' });
      return;
    }
    setDrafts((d) => without(d, resource));
    setMessage({ ok: true, text: `${USAGE_TEXT[resource].label} limit saved: ${value} a day.` });
    reload();
  }

  async function reset(resource: UsageResource) {
    setSaving({ resource, kind: 'reset' });
    const { error: err } = await supabase.from('usage_limits').delete().eq('org_id', orgId).eq('resource', resource);
    setSaving(null);
    if (err) {
      console.error('usage limit reset failed:', err.message);
      setMessage({ ok: false, text: 'Could not reset that limit.' });
      return;
    }
    setDrafts((d) => without(d, resource));
    setMessage({ ok: true, text: `${USAGE_TEXT[resource].label} limit reset to the default of ${USAGE_DEFAULTS[resource].orgLimit} a day.` });
    reload();
  }

  if (loading) return <Skeleton className="h-48 w-full max-w-xl" />;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">Lookup worker limits</h2>
        <p className="text-sm text-muted">
          How much of the shared lookup worker (site scrapes, email checks, page fetches) this organisation can use each day.
          Limits reset at 00:00 UK time. The shared worker allowance is split across all organisations and always wins, so a
          higher number here cannot get past it.
        </p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!error && rows.map((row) => {
          const s = usageState(row);
          const isDefault = row.limit === USAGE_DEFAULTS[row.resource].orgLimit;
          const busy = saving?.resource === row.resource;
          return (
            <div key={row.resource} className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Input
                    label={`${USAGE_TEXT[row.resource].label} per day`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_ORG_LIMIT}
                    value={drafts[row.resource] ?? String(row.limit)}
                    disabled={!isOrgAdmin || busy}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.resource]: e.target.value }))}
                    onBlur={() => void save(row.resource)}
                  />
                </div>
                {isOrgAdmin && !isDefault && (
                  <Button variant="ghost" loading={busy && saving?.kind === 'reset'} onClick={() => void reset(row.resource)}>
                    Reset to {USAGE_DEFAULTS[row.resource].orgLimit}
                  </Button>
                )}
              </div>
              <p className={`text-xs ${s === 'ok' ? 'text-muted' : s === 'warning' ? 'text-warning' : 'text-danger'}`}>
                Used today: {row.used} of {row.limit}. Shared worker allowance: {row.globalUsed} of {row.globalLimit} used today.
              </p>
            </div>
          );
        })}
        {!isOrgAdmin && <p className="text-xs text-muted">Only an organisation admin can edit these.</p>}
        {message && <p role="status" className={`text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
      </div>
    </Card>
  );
}
