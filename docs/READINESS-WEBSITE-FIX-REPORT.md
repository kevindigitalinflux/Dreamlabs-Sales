# Readiness confirmed-website fix — local report (2026-11-11)

Kevin authorised items 1–6 in docs/READINESS-CONFIRMED-WEBSITE-FIX-BRIEF.md, tests first and one commit per item. Roles remain Codex builder/sole checkout writer and Claude architect/reviewer. Worktree: C:/Users/kevin/Projects/dreamlabs-sales-accuracy. Branch: codex/readiness-website-fix, created from clean e95f8dd01a7d1df6d346dec8ea4a73974cbafb46 (the supplied brief commit on claude/deepfind-50-sticky). Local main was stale at 546d7be; origin/main locally recorded 64d9471. Kevin's explicit checkout/branch instruction was followed without switching to stale main or fetching. No nested Codex process was started; the authorised builder handled this checkout directly.

## Items 1–4: rule and shared display

1. **41b773c:** added the anonymised corporate shape in the existing leadReadiness test file. Before the fix it returned almost with confirmed_website missing, rather than ready. This intentionally red test-only commit preserves the reproduction; later commits make it green. New identities and emails use example.com only.
2. **90c5500:** a three-line predicate change accepts site_confirms OR lead_email OR contact_email on the saved website's exact normalised domain. Directory, blocked, suspect and needs_check guards apply to every source. Two separate email-source assertions and the suspect rejection failed before this change. The prior suspect-site test now also expects confirmed_website missing: the brief explicitly forbids confirming any suspect website, even with site proof. Person, saved verified-email, foreign-phone and readiness thresholds are unchanged.
3. **bfb01f5:** added nine negative cases covering weak website/link/search sources, pending checks despite strong sources, blocked domains, directory domains, email evidence from another domain and a suspect lookalike shape. Directory classification is stubbed for the fictional example.com fixture; the actual directory list is unchanged. All negatives pass without further production changes.
4. **f94f591:** added two actual SSR badge checks. Badges and the end-of-run reason both call readinessText from the shared module. Deep find evaluates readiness once near the end of processLead, writes the result, then uses readinessText for the saved step and reason prefix. ReadinessBadge imports the same formatter. The frontend contains no mirrored website-confirmation predicate. Picker code consumes stored flags; it does not recalculate domain confirmation. At this point the focused readiness suite passes 34 tests.

## Item 5: stored refresh investigation and proposal — TEXT ONLY, NOT EXECUTED

### What refreshes today

Source search finds one application writer of leads.readiness/readiness_missing: supabase/functions/_shared/deepFind.ts near lines 1310–1326. After saved fills and a fresh lead/contact read, it calls evaluateReadiness using this run's discovery.domains, successful checkedEmails and a website-suspicion result tied to the original site domain. It conditionally updates the lead using id, org_id and updated_at. A lost comparison fails the run rather than claiming a saved assessment. Normal lead/contact edits, restored people, email backfill and frontend badges do not refresh these fields. There is no readiness trigger in the migration or a separate readiness cron.

The successful result also stores readiness, readiness_missing, domains and website_suspect inside deep_find_leads.domains and writes the formatted reason/steps. Failed/interrupted leads do not reach the normal assessment/save. A later failure after the lead write can leave a lead assessment without a successful row result; this is another reason to use only completed saved snapshots in a repair proposal. Existing historical run reasons will remain historical unless a new run completes; this repair would update only the current lead badge fields.

A blind SQL promotion from domains is unsafe. validEmails is derived from the run's in-memory checkedEmails; the summary does not contain a complete, directly reusable version of that checker map. website_suspect is saved, but its original-site-domain qualification is not a full current-facts snapshot. Current contacts can have changed or been deleted. Missing evidence must never be replaced with every saved address or with the absence of verified_email in an old missing list.

### Smallest safe bounded refresh

After independent review and Kevin's separate approval, use a one-off service script with the exact shared evaluateReadiness module. It creates no migration, schedule, RPC or provider call. Start with an explicit org and at most fifty approved lead IDs, whose current stored missing list contains confirmed_website. Require the newest successful Deep find snapshot to have website_suspect exactly false, no active Deep find row, and complete valid-checker evidence reviewed by Kevin/Claude for the current saved addresses. If that evidence is unavailable, skip the lead; a separately approved fresh Deep find is the honest fallback, with its usual costs and side effects disclosed before running it.

The following is proposed code only, to be saved as scripts/readiness-website-refresh-once.ts **only after approval**. No such script was created or run in this task. The operator supplies a private, gitignored manifest; no real address or credential belongs in a report, commit or terminal output. Each entry includes leadId, validEmails from reviewed valid-checker results, checkerEvidenceReviewed:true, and (only after preview approval) approvedSignature. manifest.orgId scopes every query. manifest.apply defaults to false. No service secret is supplied to the assistant.

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { evaluateReadiness } from '../supabase/functions/_shared/leadReadiness.ts';
// Manifest and service credentials are operator-local, never printed or committed.
const manifest = JSON.parse(await Deno.readTextFile(Deno.args[0]));
if (!manifest.orgId || !Array.isArray(manifest.entries) || manifest.entries.length > 50)
  throw new Error('Supply one organisation and at most fifty explicitly approved leads.');
const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function state(id: string) {
  const [l, c, d, running] = await Promise.all([
    client.from('leads').select('*').eq('id', id).eq('org_id', manifest.orgId).single(),
    client.from('decision_maker_candidates').select('*').eq('lead_id', id).order('id'),
    client.from('deep_find_leads').select('id,domains,finished_at,updated_at')
      .eq('lead_id', id).eq('org_id', manifest.orgId).eq('status', 'done')
      .order('finished_at', { ascending: false, nullsFirst: false }).order('id').limit(1).maybeSingle(),
    client.from('deep_find_leads').select('id').eq('lead_id', id).eq('org_id', manifest.orgId)
      .in('status', ['queued', 'running']).limit(1),
  ]);
  if (l.error || c.error || d.error || running.error) throw new Error('Refresh facts could not be read.');
  return { lead: l.data, contacts: c.data, snapshot: d.data, active: running.data.length > 0 };
}
async function signature(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
for (const entry of manifest.entries) {
  if (entry.checkerEvidenceReviewed !== true || !Array.isArray(entry.validEmails)
      || !entry.validEmails.length || !entry.validEmails.every((e: unknown) => typeof e === 'string')) continue;
  const before = await state(entry.leadId);
  const oldMissing = before.lead.readiness_missing;
  const summary = before.snapshot?.domains;
  if (before.active || !before.lead.readiness || !Array.isArray(oldMissing)
      || !oldMissing.includes('confirmed_website') || !before.snapshot?.finished_at
      || summary?.website_suspect !== false || !Array.isArray(summary.domains)) continue;
  const inputDomains = summary.domains.filter((d: any) => typeof d.domain === 'string'
    && typeof d.needs_check === 'boolean' && Array.isArray(d.sources)
    && d.sources.every((s: unknown) => typeof s === 'string'));
  const next = evaluateReadiness({ lead: before.lead, contacts: before.contacts,
    domains: inputDomains, validEmails: entry.validEmails, websiteSuspect: false });
  // Restrict this repair to removing the website defect, not silently changing other facts.
  const targetMissing = oldMissing.filter((key: string) => key !== 'confirmed_website');
  if (JSON.stringify(next.readiness_missing) !== JSON.stringify(targetMissing)) continue;
  const stamp = await signature({ before, validEmails: entry.validEmails });
  const old = { readiness: before.lead.readiness, readiness_missing: oldMissing };
  if (manifest.apply !== true) {
    console.log({ leadId: entry.leadId, snapshotId: before.snapshot.id, before: old,
      after: next, signature: stamp }); // IDs, flags and digest only; no names or addresses.
    continue;
  }
  if (entry.approvedSignature !== stamp) throw new Error('Preview approval no longer matches.');
  const latest = await state(entry.leadId);
  if (await signature({ before: latest, validEmails: entry.validEmails }) !== stamp)
    throw new Error('Facts changed after preview; review again.');
  const saved = await client.from('leads').update(next).eq('id', entry.leadId)
    .eq('org_id', manifest.orgId).eq('updated_at', before.lead.updated_at)
    .select('id,updated_at').maybeSingle();
  if (saved.error || !saved.data) throw new Error('Conditional refresh refused; stop and review.');
  console.log({ leadId: entry.leadId, before: old, after: next, updatedAt: saved.data.updated_at });
}
```

These statements update only the two existing lead columns (plus any existing updated_at trigger). They do not rewrite deep_find_leads.reason/domains, contacts, sequences, notes, checker outcomes or consent. Pause relevant discovery jobs and avoid editing the approved leads/contacts during execution: the final read and lead comparison do not provide an atomic cross-table lock. A contact/run race remains possible between the last read and update; if a quiet interval cannot be arranged, do not run this proposal and obtain a separately reviewed transactional design. The proposal has not been typechecked/executed as a standalone script or validated against production schema/runtime. Treat it as exact review text, not a ready-authorised operation.

For each successful write, the ID/old two-column values/new updatedAt record is its bounded rollback input. A separately approved rollback would run exactly:

```ts
await client.from('leads').update(record.before).eq('id', record.leadId)
  .eq('org_id', manifest.orgId).eq('updated_at', record.updatedAt)
  .select('id,updated_at').maybeSingle();
```

A zero-row/error result means stop, not overwrite a newer assessment. The operator must retain preview/applied/rollback metadata privately and inspect partial completion before any retry.

### Which leads would change

No live query was made; no production count or membership list is asserted. The brief's reported corporate example is a candidate, not a verified repair target until its current facts and checker evidence pass preview. Actual IDs/before/after pairs come only from the approved preview above. The precise eligible class is already-checked leads with confirmed_website missing, a nonsuspect newest completed snapshot, an exact current website-domain match, needs_check false, accepted site/email evidence, no block/directory, reviewed checker evidence and no difference in the other missing facts. An almost lead missing only confirmed_website becomes ready; a needs_work lead missing decision_maker plus confirmed_website becomes almost with decision_maker still missing, assuming no independent mismatch. A suspect/blocked/directory/unchecked/weak-source or different-domain candidate is not repaired. Never-checked leads and leads lacking complete evidence are skipped. This is not blanket promotion of every old almost row.

## Item 6: final gates and importer manifest

Pending final local gates and report completion. Nothing in item 5 was run.
