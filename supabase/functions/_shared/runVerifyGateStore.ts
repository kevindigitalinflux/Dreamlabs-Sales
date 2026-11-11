import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { cachedMailProvider, lookupMx } from './dnsLookup.ts';
import { RunVerifyGate, type VerifyGateStore } from './runVerifyGate.ts';

/** Reuses the first run row's JSON summary; every mutation uses a full JSON compare-and-swap. */
export function makeRunVerifyGate(service: SupabaseClient, orgId: string, runId: string): RunVerifyGate {
  let rowId: string | null = null;
  const store: VerifyGateStore = {
    async read() {
      const { data, error } = await service.from('deep_find_leads').select('id, domains').eq('org_id', orgId).eq('run_id', runId).order('id').limit(1).maybeSingle();
      if (error || !data || !data.domains || typeof data.domains !== 'object') throw new Error('Checker run state could not be read');
      rowId = data.id;
      const state = data.domains._verify_gate ?? {};
      if (typeof state !== 'object' || state === null || Array.isArray(state)) throw new Error('Invalid checker run state');
      return { state, version: JSON.stringify(data.domains) };
    },
    async swap(version, state) {
      if (!rowId) throw new Error('Checker state row missing');
      const { data, error } = await service.from('deep_find_leads').update({ domains: { ...JSON.parse(version), _verify_gate: state } })
        .eq('id', rowId).eq('org_id', orgId).eq('run_id', runId).eq('domains', version).select('id');
      if (error) throw new Error('Checker state could not be written');
      return !!data?.length;
    },
  };
  const providers = new Map<string, Promise<boolean>>();
  return new RunVerifyGate(store, undefined, undefined, domain => {
    if (!providers.has(domain)) providers.set(domain, (async () => {
      if (cachedMailProvider(domain) === null) await lookupMx(domain);
      return ['microsoft', 'google', 'hosted'].includes(cachedMailProvider(domain) ?? 'unknown');
    })());
    return providers.get(domain)!;
  });
}

/** Saves a result without losing a concurrently written run checker checkpoint. */
export async function saveRunResult(service: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!patch.domains) {
      const { error } = await service.from('deep_find_leads').update({ ...patch, updated_at: patch.updated_at }).eq('id', id).eq('status', 'running');
      if (error) console.error('deep find: row update failed');
      return;
    }
    const { data: current, error: readError } = await service.from('deep_find_leads').select('domains, status').eq('id', id).maybeSingle();
    if (readError || !current) throw new Error('Deep find result checkpoint could not be read');
    if (current.status !== 'running') return;
    const domains = { ...(patch.domains as Record<string, unknown>), ...(current.domains?._verify_gate ? { _verify_gate: current.domains._verify_gate } : {}), ...(current.domains?._registry_proof ? {_registry_proof:current.domains._registry_proof}:{}) };
    const { data, error } = await service.from('deep_find_leads').update({ ...patch, domains, updated_at: patch.updated_at })
      .eq('id', id).eq('status', 'running').eq('domains', JSON.stringify(current.domains)).select('id');
    if (error) throw new Error('Deep find result checkpoint could not be saved');
    if (data?.length) return;
  }
  throw new Error('Deep find result checkpoint contention');
}
