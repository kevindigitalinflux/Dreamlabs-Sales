# Decision Makers as Persistent Lead Records + LinkedIn Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decision-makers found via Hunter/Apollo become a persistent, multi-entry part of a lead's record instead of overwriting the lead's own contact fields; email drafting can fan out to one or more of them; and the LinkedIn outreach queue gains a real link to leads/pipelines plus search, filter, and bulk drafting.

**Architecture:** Extend the existing `decision_maker_candidates` table (already live) to be the sole source of truth for a lead's decision-makers — remove the two places that currently copy a revealed value onto `leads.email`/`owner_name`/`phone`. Add a nullable `lead_id` bridge to `linkedin_contacts` so LinkedIn outreach can finally be scoped to a lead/pipeline. Everything else (Hunter/Apollo API contracts, the reveal/webhook security model, RLS posture) is unchanged from the already-shipped decision-maker-enrichment feature.

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres, Edge Functions/Deno, Realtime), existing Hunter/Apollo/Gemini/Claude integrations — no new external services.

**Spec:** `docs/superpowers/specs/2026-09-28-decision-makers-linkedin-phase1-design.md`

## Global Constraints

- Every edge function follows this project's established conventions: RLS-scoped client for reads a caller should only see their own data through, service-role client for writes, org-membership as a defensive second check, no client-supplied `org_id` ever trusted.
- Live verification over mocking (this project's established testing style) — no Deno test harness exists; verify edge function changes against the real deployed project using this project's established temporary-insert-then-full-cleanup-and-independently-verify pattern for any live data touched. Mr Brush & Co (`org_id 0a3d8195-f840-44e3-9b9d-063b22d98b63`) has real, working Hunter and Google Places keys; Apollo is Free-plan-blocked (confirmed in the prior decision-maker-enrichment cycle) — do not expect a live Apollo success, only that the code reaches Apollo correctly and fails cleanly.
- **Ruling — auto-captured LinkedIn contacts get `context_signal: null`, never a synthesized "title at company" string.** `draft-linkedin-message` interpolates `context_signal` directly into its achievement/life_update templates (e.g. `"saw you ${context_signal}"`); a title/company descriptor would read as a non-sequitur there. `null` correctly falls back to the safe, generic `'general'` template.
- **Ruling — EmailComposer's multi-recipient send uses one shared, hand-editable subject/body sent identically to every checked recipient; per-recipient AI text personalization is NOT built into EmailComposer in this plan.** Genuine per-recipient personalization (a distinct AI-drafted body per decision-maker) is delivered through `BulkDraftModal` instead, which already makes one independent `generate-email` call per lead and can trivially extend that to one call per (lead, recipient) pair with no shared-editing-state conflict. Building true per-recipient editable drafts into EmailComposer's single shared-textarea UI would require either N parallel edit surfaces or losing manual editing entirely for the multi-recipient case — both bigger changes than this task's value justifies. This still fully delivers "send separate emails to multiple people at once" with independent tracking per send.
- No new database tables — only new nullable columns on existing tables, so every existing row and query keeps working unchanged.
- `applied_at` was already dropped from `decision_maker_candidates` in the prior cycle (migration 031) — do not reintroduce it. "Found" is now the only state; there is no separate "applied" state anymore.

---

### Task 1: Migration — decision-maker/LinkedIn schema additions

**Files:**
- Create: `supabase/migrations/034_decision_makers_linkedin_phase1.sql`

**Interfaces:**
- Produces: `decision_maker_candidates.linkedin_url` (TEXT, nullable), `email_logs.decision_maker_candidate_id` (UUID, nullable, FK), `linkedin_contacts.lead_id` (UUID, nullable, FK), `linkedin_contacts.decision_maker_candidate_id` (UUID, nullable, FK) with a partial unique index — every later task's writes to these columns depend on this migration having run first.

- [ ] **Step 1: Write the migration**

`supabase/migrations/034_decision_makers_linkedin_phase1.sql`:

```sql
-- Decision-maker candidates: capture a LinkedIn URL when Hunter/Apollo
-- provide one (see Task 2). No other change to this table — it was already
-- the persistent per-lead record as of migration 030; this plan just stops
-- OTHER code from also copying its values onto leads.email/owner_name/phone
-- (Task 4), making it the sole source of truth.
ALTER TABLE decision_maker_candidates ADD COLUMN linkedin_url TEXT;

-- email_logs: which decision-maker (if any) a send went to, distinct from
-- the lead's own primary contact. Nullable -- every existing row and every
-- send that targets the lead's own email leaves this null.
ALTER TABLE email_logs ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;

-- linkedin_contacts: bridge to leads/pipelines. Both nullable so every
-- existing manually-added contact (no lead tie today) keeps working
-- unchanged, surfaced under an "Unlinked" bucket in the UI (Task 11) rather
-- than breaking or disappearing.
ALTER TABLE linkedin_contacts ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE linkedin_contacts ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;

-- Makes the auto-capture upsert in Task 3 idempotent: re-running "Find
-- decision maker" for a lead whose candidate already has a LinkedIn contact
-- updates that same row instead of creating a duplicate. Partial (WHERE ...
-- IS NOT NULL) so multiple manually-added contacts with no candidate link
-- are unaffected.
CREATE UNIQUE INDEX linkedin_contacts_candidate_unique ON linkedin_contacts (decision_maker_candidate_id) WHERE decision_maker_candidate_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration live**

Use this project's established Supabase MCP `apply_migration` tool (project id `wgomksxelyfkzepbnkdd`), name `decision_makers_linkedin_phase1`, with the SQL above.

- [ ] **Step 3: Live-verify the schema and the partial unique index**

```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_name in ('decision_maker_candidates', 'email_logs', 'linkedin_contacts')
  and column_name in ('linkedin_url', 'decision_maker_candidate_id', 'lead_id')
order by table_name, column_name;
```
Expected: 4 rows, all `is_nullable = 'YES'`.

Then verify the partial unique index actually rejects a duplicate `decision_maker_candidate_id` but allows multiple `NULL`s, using a real (existing) candidate id and cleaning up fully afterward — this project's established temp-insert-then-cleanup pattern:

```sql
-- Find any real lead + a throwaway insert target (adjust ids as needed for
-- whatever real data exists at run time; do not hardcode the ids below).
select id from decision_maker_candidates limit 1; -- call this <real_candidate_id>

BEGIN;
insert into linkedin_contacts (org_id, full_name, decision_maker_candidate_id)
select org_id, 'Test One', '<real_candidate_id>' from leads join decision_maker_candidates dc on dc.lead_id = leads.id where dc.id = '<real_candidate_id>' limit 1;
-- Second insert with the SAME decision_maker_candidate_id must fail:
insert into linkedin_contacts (org_id, full_name, decision_maker_candidate_id)
select org_id, 'Test Two', '<real_candidate_id>' from leads join decision_maker_candidates dc on dc.lead_id = leads.id where dc.id = '<real_candidate_id>' limit 1;
-- Expected: ERROR duplicate key value violates unique constraint "linkedin_contacts_candidate_unique"
ROLLBACK; -- never commits either test row
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/034_decision_makers_linkedin_phase1.sql
git commit -m "feat: add linkedin_url, decision_maker_candidate_id, and lead_id columns for decision-makers/LinkedIn phase 1"
```

---

### Task 2: Capture LinkedIn URL from Hunter and Apollo responses

**Files:**
- Modify: `supabase/functions/_shared/apolloHunterLookup.ts`
- Modify: `supabase/functions/_shared/apolloPeopleSearch.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HunterDecisionMakerCandidate.linkedinUrl: string | null`, `ApolloPersonCandidate.linkedinUrl: string | null` — Task 3 reads both. `DecisionMakerCandidate.linkedin_url: string | null` (frontend type) — Task 5 reads it.

- [ ] **Step 1: Extend Hunter's parse types and function**

In `supabase/functions/_shared/apolloHunterLookup.ts`, update the `HunterEmailEntry` interface and `HunterDecisionMakerCandidate` interface, and `findHunterDecisionMaker`'s return:

```typescript
interface HunterEmailEntry {
  value: string;
  confidence: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  linkedin?: string | null;
}

export interface HunterDecisionMakerCandidate {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string;
  linkedinUrl: string | null;
}
```

Update the return statement at the end of `findHunterDecisionMaker`:

```typescript
    const top = ranked[0]!;
    return { firstName: top.first_name ?? null, lastName: top.last_name ?? null, title: top.position ?? null, email: top.value, linkedinUrl: top.linkedin || null };
```

(`|| null` rather than `?? null`, matching this file's existing style, since Hunter can return an empty string for an unset field — treat empty string the same as absent.)

- [ ] **Step 2: Extend Apollo's parse type and function**

In `supabase/functions/_shared/apolloPeopleSearch.ts`, update the response type and `ApolloPersonCandidate` interface in `searchApolloDecisionMaker`:

```typescript
export interface ApolloPersonCandidate {
  apolloPersonId: string;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
  linkedinUrl: string | null;
}
```

```typescript
    const data = await res.json() as { people?: { id?: string; first_name?: string; last_name_obfuscated?: string; title?: string | null; linkedin_url?: string | null }[] };
    const top = data.people?.[0];
    if (!top?.id) return null;
    return {
      apolloPersonId: top.id,
      firstName: top.first_name ?? null,
      lastNameObfuscated: top.last_name_obfuscated ?? null,
      title: top.title ?? null,
      linkedinUrl: top.linkedin_url || null,
    };
```

**Note for verification (Step 4 below):** Apollo's `linkedin_url` field is documented in Apollo's public API schema but cannot be live-confirmed against a real response on Mr Brush & Co (Free-plan-blocked, per Task 3/5 of the prior decision-maker-enrichment cycle). This is fine — the code degrades correctly to `null` if the field is genuinely absent, same as every other optional field this file already parses defensively.

- [ ] **Step 3: Add `linkedin_url` to the frontend `DecisionMakerCandidate` type**

In `src/types/index.ts`, add one field to the existing `DecisionMakerCandidate` interface (around line 74-89):

```typescript
export interface DecisionMakerCandidate {
  id: string;
  lead_id: string;
  source: 'hunter' | 'apollo';
  apollo_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name_obfuscated: boolean;
  title: string | null;
  email: string | null;
  email_revealed: boolean;
  phone: string | null;
  phone_status: 'not_requested' | 'pending' | 'revealed' | 'not_found' | 'failed';
  linkedin_url: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean. These are pure type/parsing changes with no live-callable surface of their own yet (Task 3 wires them in) — a clean typecheck is the bar for this task.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/apolloHunterLookup.ts supabase/functions/_shared/apolloPeopleSearch.ts src/types/index.ts
git commit -m "feat: parse linkedin_url from Hunter and Apollo decision-maker responses"
```

---

### Task 3: Auto-capture a linked LinkedIn contact when a decision-maker has a LinkedIn URL

**Files:**
- Modify: `supabase/functions/find-decision-makers/index.ts`

**Interfaces:**
- Consumes: `HunterDecisionMakerCandidate.linkedinUrl`, `ApolloPersonCandidate.linkedinUrl` (Task 2).
- Produces: nothing new consumed by a later task — this is the terminal write for the auto-capture behavior.

- [ ] **Step 1: Pass `linkedin_url` into the upsert rows and auto-create the linked contact**

In `supabase/functions/find-decision-makers/index.ts`, update the `runBounded` callback:

```typescript
  const perLead = await runBounded(resolvedLeads, 5, async (lead) => {
    const domain = bareDomain(lead.website ?? '');
    if (!domain) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    const rows: Record<string, unknown>[] = [];

    if (hunterKey) {
      const hunter = await findHunterDecisionMaker(lead.website, hunterKey);
      if (hunter) {
        rows.push({
          lead_id: lead.id, source: 'hunter',
          first_name: hunter.firstName, last_name: hunter.lastName, title: hunter.title,
          email: hunter.email, email_revealed: true, name_obfuscated: false,
          linkedin_url: hunter.linkedinUrl,
          created_by: userData.user.id,
        });
      }
    }
    if (apolloKey) {
      const apollo = await searchApolloDecisionMaker(domain, apolloKey);
      if (apollo) {
        rows.push({
          lead_id: lead.id, source: 'apollo', apollo_person_id: apollo.apolloPersonId,
          first_name: apollo.firstName, last_name: apollo.lastNameObfuscated, title: apollo.title,
          name_obfuscated: true, email_revealed: false,
          linkedin_url: apollo.linkedinUrl,
          created_by: userData.user.id,
        });
      }
    }

    if (rows.length === 0) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    // Deliberately omits phone/phone_status: PostgREST's upsert only SETs the
    // columns present in the payload, so re-running search on a lead with an
    // in-progress or already-revealed Apollo phone leaves that state
    // untouched instead of resetting it back to defaults.
    const { data: upserted, error: upsertErr } = await service
      .from('decision_maker_candidates')
      .upsert(rows, { onConflict: 'lead_id,source' })
      .select('*');
    if (upsertErr) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    // Auto-capture: any candidate with a LinkedIn URL gets a linked
    // linkedin_contacts row immediately, so it shows up in the LinkedIn
    // queue without a separate action (matches the controller-approved
    // design: "automatic, as soon as found"). context_signal stays null --
    // see this plan's Global Constraints for why. Idempotent via the
    // partial unique index on decision_maker_candidate_id (Task 1).
    for (const candidate of (upserted ?? []) as { id: string; first_name: string | null; last_name: string | null; linkedin_url: string | null }[]) {
      if (!candidate.linkedin_url) continue;
      const fullName = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() || 'Unknown';
      await service.from('linkedin_contacts').upsert({
        org_id: orgId,
        lead_id: lead.id,
        decision_maker_candidate_id: candidate.id,
        full_name: fullName,
        linkedin_url: candidate.linkedin_url,
        context_signal: null,
        created_by: userData.user.id,
      }, { onConflict: 'decision_maker_candidate_id' });
    }

    return { lead_id: lead.id, candidates: upserted ?? [] };
  });
```

(Only the additions are new — the rest of the callback body is unchanged from what's already deployed.)

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Live-verify against Mr Brush & Co, with full cleanup**

Hunter is usable today on this org (Apollo is Free-plan-blocked, so only Hunter can realistically produce a `linkedin_url` right now). Using this project's established temporary-insert-then-cleanup pattern:

1. Insert one temporary lead for Mr Brush & Co (`org_id 0a3d8195-f840-44e3-9b9d-063b22d98b63`) with a real website domain known from prior cycles to return a Hunter result (e.g. `prestigejanitorial.com`, which produced a real Hunter candidate — Stephanie Campbell — during the prior decision-maker-enrichment cycle's Task 4 verification).
2. Invoke `find-decision-makers` for that lead as a real authenticated Mr Brush & Co user (reuse this project's established throwaway-auth-user pattern if no live session is available).
3. Confirm: a `decision_maker_candidates` row was created with a non-null `linkedin_url` **if and only if** Hunter's real response actually included one for this contact (it may not — that's a valid, expected outcome, not a failure; if it's null, note that in your report and this is still a PASS as long as the code path was exercised without error).
4. If `linkedin_url` was non-null: confirm a matching `linkedin_contacts` row was created with the correct `lead_id`, `decision_maker_candidate_id`, `full_name`, `linkedin_url`, and `context_signal IS NULL`.
5. Re-invoke `find-decision-makers` for the same lead a second time — confirm no duplicate `linkedin_contacts` row was created (still exactly one, same id, upserted not duplicated).
6. Fully delete the temporary lead (cascades to its `decision_maker_candidates` and `linkedin_contacts` rows via `ON DELETE CASCADE`) and independently re-verify via a fresh count query that Mr Brush & Co is back to its exact prior baseline.

- [ ] **Step 4: Redeploy**

Redeploy `find-decision-makers` via the Supabase MCP `deploy_edge_function` tool. **Check this function's exact file-layout convention first** via `get_edge_function` before redeploying (this project's functions use inconsistent conventions — some need `entrypoint_path: "index.ts"` with shared files at top-level `_shared/...`, matching a `./_shared/...` import; do not assume without checking).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/find-decision-makers/index.ts
git commit -m "feat: auto-capture a linked LinkedIn contact when a decision-maker has a LinkedIn URL"
```

---

### Task 4: Stop writing revealed decision-maker data onto `leads`

**Files:**
- Modify: `supabase/functions/reveal-decision-maker/index.ts`
- Modify: `supabase/functions/apollo-phone-webhook/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task removes behavior, it doesn't add an interface.

- [ ] **Step 1: Remove the `leads` write from `reveal-decision-maker`, sync the linked LinkedIn contact's name on email reveal**

In `supabase/functions/reveal-decision-maker/index.ts`, remove this block entirely (currently right before the final `return`):

```typescript
  if (revealEmail && result.email) {
    const leadPatch: Record<string, unknown> = { email: result.email };
    if (result.firstName || result.lastName) leadPatch.owner_name = [result.firstName, result.lastName].filter(Boolean).join(' ');
    await client.from('leads').update(leadPatch).eq('id', row.lead_id);
  }
```

Replace it with a sync of the candidate's real name onto its linked LinkedIn contact, if one exists — otherwise an Apollo candidate revealed after Task 3's auto-capture would keep showing its obfuscated name (e.g. "Andrew Hu\*\*\*n") in the LinkedIn queue forever, even after the real name is known:

```typescript
  if (revealEmail && result.email && (result.firstName || result.lastName)) {
    const fullName = [result.firstName, result.lastName].filter(Boolean).join(' ');
    await service.from('linkedin_contacts').update({ full_name: fullName }).eq('decision_maker_candidate_id', candidateId);
  }
```

(Uses `service`, not `client` — this is the same posture as every other write in this function to `decision_maker_candidates`/`linkedin_contacts`, neither of which has a client-writable RLS policy. `.eq('decision_maker_candidate_id', candidateId)` is a no-op, not an error, when no LinkedIn contact exists for this candidate — matches this function's existing "best-effort, never block the response" style.)

The rest of the function — the visibility pre-check, the Apollo credit-spend gating, the constant-time webhook token, the `decision_maker_candidates` update itself — is unchanged.

- [ ] **Step 2: Remove the `leads` write from `apollo-phone-webhook`**

In `supabase/functions/apollo-phone-webhook/index.ts`, change:

```typescript
    if (chosen?.raw_number) {
      await service.from('decision_maker_candidates')
        .update({ phone: chosen.raw_number, phone_status: 'revealed', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
      await service.from('leads').update({ phone: chosen.raw_number }).eq('id', candidate.lead_id);
    } else {
```

to:

```typescript
    if (chosen?.raw_number) {
      await service.from('decision_maker_candidates')
        .update({ phone: chosen.raw_number, phone_status: 'revealed', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
    } else {
```

(Just the one line removed — everything else in this function, including its security model, is unchanged. `candidate.lead_id` is no longer referenced anywhere in this function after this removal; leave the `select('id, lead_id')` on the line above as-is rather than narrowing it, since `lead_id` still has no other use here but narrowing the select for one now-unused column isn't worth the diff noise.)

- [ ] **Step 3: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Live-verify the regression is genuinely fixed**

Using this project's established temporary-insert-then-cleanup pattern on Mr Brush & Co:

1. Insert one temporary lead with a known `email`/`owner_name`/`phone` already set (so a bug reintroducing the old write would be visible as a *change*, not just an unexpected value on a previously-null field).
2. Insert one temporary `decision_maker_candidates` row for it with `source = 'apollo'`, a realistic-but-fabricated `apollo_person_id`, `email_revealed: false`.
3. Call `reveal-decision-maker` with `reveal_email: true` for that candidate. Apollo's Free-plan block means this will fail with the same clean 502 already established in the prior cycle (`Apollo could not reveal this contact`) — that's expected. Confirm the lead's `email`/`owner_name` are **byte-identical** to what they were before the call (this is the actual regression check — a 502 alone doesn't prove the removed code path is gone if it was buggy in some other way).
4. Directly `UPDATE` the temporary candidate row to simulate a successful reveal (`email_revealed = true, email = 'test@example.com', first_name = 'Test', last_name = 'Person'`) the same way the function itself would on success, then confirm the lead's own columns are still unchanged — proving the write-removal is structurally correct, not just untriggered by Apollo's block.
5. Fully delete the temporary lead and candidate, independently re-verify baseline.

- [ ] **Step 5: Redeploy both functions**

Check each function's exact file-layout convention via `get_edge_function` before redeploying (`reveal-decision-maker` and `apollo-phone-webhook` may each have their own established convention from the prior cycle — do not assume they match each other).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/reveal-decision-maker/index.ts supabase/functions/apollo-phone-webhook/index.ts
git commit -m "fix: stop overwriting leads.email/owner_name/phone on decision-maker reveal"
```

---

### Task 5: Persistent "Decision Makers" section on the lead detail page

**Files:**
- Create: `src/components/pipeline/DecisionMakersCard.tsx`
- Modify: `src/pages/LeadDetailPage.tsx`

**Interfaces:**
- Consumes: `DecisionMakerCandidate` (Task 2's `linkedin_url` addition), the existing `reveal-decision-maker` edge function (unchanged contract).
- Produces: `<DecisionMakersCard leadId={string} />` — a self-contained component, no props beyond `leadId`, used only by `LeadDetailPage.tsx` in this plan.

- [ ] **Step 1: Write the component**

`src/components/pipeline/DecisionMakersCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { readableInvokeError } from '../../lib/invokeError';
import type { DecisionMakerCandidate } from '../../types';
import { Button } from '../ui/Button';

function candidateName(c: DecisionMakerCandidate): string {
  const first = c.first_name ?? '';
  const last = c.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown name';
}

/**
 * Persistent list of every decision-maker candidate found for this lead
 * (via "Find decision maker") -- unlike the bulk-search review modal, this
 * is the lead's own permanent record, not a transient search result.
 * Subscribes to realtime updates scoped to this lead so an Apollo reveal or
 * phone webhook lands here live, with no polling and no manual refresh.
 */
export function DecisionMakersCard({ leadId }: { leadId: string }) {
  const [candidates, setCandidates] = useState<DecisionMakerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', leadId).order('created_at').then(({ data }) => {
      if (!cancelled) { setCandidates((data as DecisionMakerCandidate[]) ?? []); setLoading(false); }
    });
    const channel = supabase
      .channel(`decision-makers-card-${leadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decision_maker_candidates', filter: `lead_id=eq.${leadId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCandidates((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
          return;
        }
        const row = payload.new as DecisionMakerCandidate;
        setCandidates((prev) => {
          const exists = prev.some((c) => c.id === row.id);
          return exists ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row];
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [leadId]);

  async function handleReveal(candidate: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(candidate.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', {
      body: { candidate_id: candidate.id, [field]: true },
    });
    setBusyId(null);
    const apiError = error ? await readableInvokeError(error) : (data as { error?: string } | null)?.error;
    if (apiError) { setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: apiError })); return; }
    setErrorByCandidate((prev) => {
      if (!(candidate.id in prev)) return prev;
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    // The realtime subscription above applies the actual update -- no local merge needed here.
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">No decision-makers found yet — use "Find decision maker" from the Pipeline list to search.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="rounded-lg bg-surface/60 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
            <span className="font-semibold">{candidateName(candidate)}</span>
            {candidate.title && <span className="text-muted">— {candidate.title}</span>}
            {candidate.linkedin_url && (
              <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cyan">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> LinkedIn
              </a>
            )}
          </div>
          {candidate.source === 'hunter' && <p className="mt-1 text-success">{candidate.email}</p>}
          {candidate.source === 'apollo' && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleReveal(candidate, 'reveal_email')}
                disabled={busyId === candidate.id || candidate.email_revealed}
                loading={busyId === candidate.id}
              >
                {candidate.email_revealed ? candidate.email! : busyId === candidate.id ? 'Revealing…' : 'Reveal email'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleReveal(candidate, 'reveal_phone')}
                disabled={busyId === candidate.id || candidate.phone_status !== 'not_requested'}
                loading={busyId === candidate.id}
              >
                {candidate.phone_status === 'revealed' ? candidate.phone!
                  : candidate.phone_status === 'pending' ? 'Waiting for phone number…'
                  : candidate.phone_status === 'not_found' ? 'No phone found'
                  : busyId === candidate.id ? 'Revealing…' : 'Reveal phone'}
              </Button>
            </div>
          )}
          {errorByCandidate[candidate.id] && <p role="alert" className="mt-1 text-xs text-danger">{errorByCandidate[candidate.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Wire it into the lead detail page**

In `src/pages/LeadDetailPage.tsx`, add the import:

```typescript
import { DecisionMakersCard } from '../components/pipeline/DecisionMakersCard';
```

Add a new `<Card>` right after the existing Contact card (after the `</Card>` that closes the "Contact" section, before the "Pipeline" section's `<Card>`):

```tsx
      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Decision Makers</h2>
        <DecisionMakersCard leadId={lead.id} />
      </Card>
```

- [ ] **Step 3: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Live-verify in the browser**

Start the dev server, navigate to a lead detail page for a lead with at least one `decision_maker_candidates` row (create a temporary one on Mr Brush & Co if none exist, using this project's established pattern — clean it up afterward). Confirm:
- The Decision Makers card renders the candidate with correct source badge, name, title.
- If a LinkedIn URL is present, the link renders and opens correctly in a new tab.
- For an Apollo candidate, clicking "Reveal email" shows the loading state, then either the real email (if somehow available) or a clean error message (expected: Apollo Free-plan 502) — confirm no crash either way.
- Clean up any temporary data created for this test.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/DecisionMakersCard.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: add persistent Decision Makers card to the lead detail page"
```

---

### Task 6: Simplify the bulk-search review modal — drop "Add to lead"

**Files:**
- Modify: `src/components/pipeline/DecisionMakerReview.tsx`
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DecisionMakerReviewProps` loses `onApplyHunter` — `PipelineList.tsx` is the only caller and is updated in this same task.

- [ ] **Step 1: Remove the Hunter "Add to lead" button and the `onApplyHunter` prop**

In `src/components/pipeline/DecisionMakerReview.tsx`, remove `onApplyHunter` from the props interface and destructuring, remove the `appliedIds` state and `handleApplyHunter` function entirely (nothing calls them anymore), and replace the Hunter row's JSX:

```tsx
                    {candidate.source === 'hunter' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-success">{candidate.email}</span>
                        <Button
                          variant="secondary"
                          onClick={() => void handleApplyHunter(leadId, candidate)}
                          disabled={busyId === candidate.id || appliedIds.has(candidate.id)}
                          loading={busyId === candidate.id}
                        >
                          {appliedIds.has(candidate.id) ? 'Added' : busyId === candidate.id ? 'Adding…' : 'Add to lead'}
                        </Button>
                      </div>
                    )}
```

with:

```tsx
                    {candidate.source === 'hunter' && (
                      <p className="mt-1 text-success">{candidate.email}</p>
                    )}
```

And add a one-line hint near the top of the modal body, right after the opening `<div className="flex flex-col gap-4">`:

```tsx
        <p className="text-xs text-muted">Full contact list for each lead is on its own Decision Makers section.</p>
```

The full updated component:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { readableInvokeError } from '../../lib/invokeError';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface DecisionMakerReviewProps {
  open: boolean;
  resultsByLead: Record<string, DecisionMakerCandidate[]>;
  leadsById: Record<string, Lead>;
  onClose: () => void;
}

function candidateName(c: DecisionMakerCandidate): string {
  const first = c.first_name ?? '';
  const last = c.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown name';
}

/**
 * Review UI for the "Find decision maker" bulk-search action -- a summary
 * of what turned up across the selected leads, for when you don't want to
 * visit each lead's own detail page. Every candidate found is already
 * persistent on its lead (see DecisionMakersCard) -- there is no "add to
 * lead" action here anymore, only Apollo's explicit, already-consented
 * "Reveal email"/"Reveal phone" (Hunter candidates arrive already
 * revealed). Subscribes to realtime updates on the visible candidate rows
 * so a phone number appears the moment Apollo's webhook lands, with no
 * polling.
 */
export function DecisionMakerReview({ open, resultsByLead, leadsById, onClose }: DecisionMakerReviewProps) {
  const [candidatesByLead, setCandidatesByLead] = useState<Record<string, DecisionMakerCandidate[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    setCandidatesByLead(resultsByLead);
    setErrorByCandidate({});
  }, [resultsByLead]);

  useEffect(() => {
    const allIds = Object.values(resultsByLead).flat().map((c) => c.id);
    if (allIds.length === 0) return;
    const channel = supabase
      .channel(`decision-maker-candidates-${allIds[0]}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'decision_maker_candidates', filter: `id=in.(${allIds.join(',')})` }, (payload) => {
        const updated = payload.new as DecisionMakerCandidate;
        setCandidatesByLead((prev) => {
          const list = prev[updated.lead_id];
          if (!list) return prev;
          return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByLead]);

  async function handleReveal(candidate: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(candidate.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', {
      body: { candidate_id: candidate.id, [field]: true },
    });
    setBusyId(null);
    const apiError = error ? await readableInvokeError(error) : (data as { error?: string } | null)?.error;
    if (apiError) { setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: apiError })); return; }
    const updated = (data as { candidate: DecisionMakerCandidate }).candidate;
    setCandidatesByLead((prev) => {
      const list = prev[updated.lead_id];
      if (!list) return prev;
      return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
    });
  }

  const leadIds = Object.keys(candidatesByLead);

  return (
    <Modal open={open} onClose={onClose} title="Find decision maker">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">Full contact list for each lead is on its own Decision Makers section.</p>
        {leadIds.length === 0 && <p className="text-sm text-muted">No decision-maker candidates found for the selected leads.</p>}
        {leadIds.map((leadId) => {
          const lead = leadsById[leadId];
          const candidates = candidatesByLead[leadId] ?? [];
          return (
            <div key={leadId} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{lead?.business_name ?? leadId}</p>
              <ul className="flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="rounded bg-surface/60 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
                      <span className="font-semibold">{candidateName(candidate)}</span>
                      {candidate.title && <span className="text-muted">— {candidate.title}</span>}
                    </div>
                    {candidate.source === 'hunter' && (
                      <p className="mt-1 text-success">{candidate.email}</p>
                    )}
                    {candidate.source === 'apollo' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_email')}
                          disabled={busyId === candidate.id || candidate.email_revealed}
                          loading={busyId === candidate.id}
                        >
                          {candidate.email_revealed ? candidate.email! : busyId === candidate.id ? 'Revealing…' : 'Reveal email'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_phone')}
                          disabled={busyId === candidate.id || candidate.phone_status !== 'not_requested'}
                          loading={busyId === candidate.id}
                        >
                          {candidate.phone_status === 'revealed' ? candidate.phone!
                            : candidate.phone_status === 'pending' ? 'Waiting for phone number…'
                            : candidate.phone_status === 'not_found' ? 'No phone found'
                            : busyId === candidate.id ? 'Revealing…' : 'Reveal phone'}
                        </Button>
                      </div>
                    )}
                    {errorByCandidate[candidate.id] && <p role="alert" className="mt-1 text-xs text-danger">{errorByCandidate[candidate.id]}</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Remove the now-dead `onApplyHunter` wiring from `PipelineList.tsx`**

In `src/pages/PipelineList.tsx`, remove the `handleApplyHunterCandidate` function entirely:

```typescript
  async function handleApplyHunterCandidate(leadId: string, candidate: DecisionMakerCandidate): Promise<string | null> {
    const patch: Record<string, string> = { email: candidate.email! };
    const name = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim();
    if (name) patch.owner_name = name;
    return updateLead(leadId, patch);
  }
```

And remove the `onApplyHunter` prop from the `<DecisionMakerReview>` render:

```tsx
        <DecisionMakerReview
          open={decisionMakerReviewOpen}
          resultsByLead={decisionMakerResults}
          leadsById={leadsById}
          onClose={() => setDecisionMakerReviewOpen(false)}
          onApplyHunter={handleApplyHunterCandidate}
        />
```

becomes:

```tsx
        <DecisionMakerReview
          open={decisionMakerReviewOpen}
          resultsByLead={decisionMakerResults}
          leadsById={leadsById}
          onClose={() => setDecisionMakerReviewOpen(false)}
        />
```

- [ ] **Step 3: Run the typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, 92/92 (or whatever the current count is) still passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/DecisionMakerReview.tsx src/pages/PipelineList.tsx
git commit -m "refactor: drop 'Add to lead' from the decision-maker review modal"
```

---

### Task 7: Multi-recipient backend support — `generate-email` and `send-email`

**Files:**
- Modify: `supabase/functions/generate-email/index.ts`
- Modify: `supabase/functions/send-email/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `generate-email` accepts an optional `recipient_name: string` in its request body — Task 9 (`BulkDraftModal`) uses this. `send-email` accepts an optional `decision_maker_candidate_id: string` in its request body, stored on the `email_logs` row — Task 8 (`EmailComposer`) uses this.

- [ ] **Step 1: `generate-email` — accept a recipient-name override**

In `supabase/functions/generate-email/index.ts`, change the body type and add the override right after the lead is fetched:

```typescript
  const body = (await req.json()) as { lead_id?: string; template_id?: string; use_ai?: boolean; recipient_name?: string };
  if (!body.lead_id || !body.template_id) return json({ error: 'lead_id and template_id required' }, 400, headers);

  // RLS applies: contractors can only draft for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  // When drafting for a specific decision-maker rather than the lead's own
  // contact, override owner_name for template substitution and AI drafting
  // -- every downstream consumer (buildTemplateVars, draftEmail) already
  // reads owner_name off this object, so nothing else needs to change.
  const leadForDraft: Record<string, unknown> = body.recipient_name
    ? { ...(lead as Record<string, unknown>), owner_name: body.recipient_name }
    : (lead as Record<string, unknown>);
  const template = ...
```

Then replace every subsequent use of `lead as Record<string, unknown>` (in `buildTemplateVars` and `draftEmail`'s `lead` argument) with `leadForDraft`. Uses of `lead` for identity/org lookups (`(lead as { org_id: string }).org_id`) stay as `lead`, not `leadForDraft` — both hold the same `org_id` since `leadForDraft` is a shallow copy, so this is purely a style choice for clarity, not a correctness requirement. The full updated function:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = (await req.json()) as { lead_id?: string; template_id?: string; use_ai?: boolean; recipient_name?: string };
  if (!body.lead_id || !body.template_id) return json({ error: 'lead_id and template_id required' }, 400, headers);

  // RLS applies: contractors can only draft for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  // When drafting for a specific decision-maker rather than the lead's own
  // contact, override owner_name for template substitution and AI drafting
  // -- every downstream consumer (buildTemplateVars, draftEmail) already
  // reads owner_name off this object, so nothing else needs to change.
  const leadForDraft: Record<string, unknown> = body.recipient_name
    ? { ...(lead as Record<string, unknown>), owner_name: body.recipient_name }
    : (lead as Record<string, unknown>);
  const { data: template } = await client.from('email_templates').select('*').eq('id', body.template_id).single();
  if (!template) return json({ error: 'Template not found' }, 404, headers);
  const { data: notes } = await client
    .from('lead_notes').select('content').eq('lead_id', body.lead_id)
    .order('created_at', { ascending: false }).limit(3);
  const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);
  const { data: profile } = await client.from('profiles').select('full_name, email').eq('id', userData.user.id).single();
  const contractorName = (profile?.full_name ?? profile?.email ?? 'The Dreamlabs team').split(' ')[0]!;

  const vars = buildTemplateVars(leadForDraft, contractorName, noteTexts);
  const subject = substituteVariables(template.subject as string, vars);
  const bodyText = substituteVariables(template.body as string, vars);
  const missing = [...new Set([...subject.missing, ...bodyText.missing])];

  if (body.use_ai === false) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  const orgId = (lead as { org_id: string }).org_id;
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  const { data: org } = await service.from('organizations').select('name, company_context').eq('id', orgId).maybeSingle();
  const orgName = org?.name ?? 'our team';
  try {
    const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: leadForDraft, notes: noteTexts, contractorName, orgName, companyContext: org?.company_context, apiKey });
    return json({ subject: ai.subject, body: ai.body, ai_used: true, missing }, 200, headers);
  } catch (e) {
    console.error('draftEmail failed, falling back to plain template:', e);
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
});
```

- [ ] **Step 2: `send-email` — accept and store `decision_maker_candidate_id`**

In `supabase/functions/send-email/index.ts`, change the body type:

```typescript
  const body = (await req.json()) as { to_email?: string; subject?: string; body?: string; lead_id?: string; log_id?: string; decision_maker_candidate_id?: string };
```

And add the field to the `row` object built before the insert/update:

```typescript
  const row: Record<string, unknown> = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    message_id: messageId, sent_at: new Date().toISOString(),
    decision_maker_candidate_id: body.decision_maker_candidate_id ?? null,
  };
```

No other change to this function — the membership/ownership checks, draft-claiming rules, and `last_contacted_at`/stage-advance logic are already lead-scoped, not recipient-scoped, so they apply correctly regardless of which specific person at that lead's company the email went to.

- [ ] **Step 3: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Live-verify both changes**

1. `generate-email`: call it twice for the same real lead+template — once with no `recipient_name`, once with `recipient_name: 'Jane Doe'` — confirm the second response's `subject`/`body` reflect "Jane Doe" wherever the template uses `{{owner_name}}`/`{{first_name}}`, and the first response is unaffected (matches current behavior exactly, proving the override is opt-in and non-breaking).
2. `send-email`: using this project's established temporary-insert-then-cleanup pattern, send one test email with `decision_maker_candidate_id` set to a real (temporary) candidate id and confirm the resulting `email_logs` row has that value stored; send another without it and confirm the row has `NULL`. Clean up both temporary rows and the temporary lead/candidate they reference.

- [ ] **Step 5: Redeploy both functions**

Check each function's file-layout convention via `get_edge_function` first.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-email/index.ts supabase/functions/send-email/index.ts
git commit -m "feat: support a recipient-name override and decision-maker attribution in email sending"
```

---

### Task 8: `EmailComposer` — multi-recipient checklist

**Files:**
- Modify: `src/components/emails/EmailComposer.tsx`

**Interfaces:**
- Consumes: `DecisionMakerCandidate` (Task 2), `send-email`'s `decision_maker_candidate_id` field (Task 7).
- Produces: nothing new consumed elsewhere in this plan.

- [ ] **Step 1: Rewrite the component**

Per this plan's Global Constraints, this sends the same hand-edited subject/body to every checked recipient — no per-recipient AI text variation (that's `BulkDraftModal`'s job, Task 9).

`src/components/emails/EmailComposer.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Send, Sparkles, WandSparkles } from 'lucide-react';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface DiffLine { kind: 'same' | 'removed' | 'added'; text: string }

/** Line-level LCS diff for the template → AI-draft comparison. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ kind: 'same', text: A[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'removed', text: A[i]! }); i++; }
    else { out.push({ kind: 'added', text: B[j]! }); j++; }
  }
  while (i < A.length) out.push({ kind: 'removed', text: A[i++]! });
  while (j < B.length) out.push({ kind: 'added', text: B[j++]! });
  return out;
}

interface EmailComposerProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  /** When reviewing an existing draft from the queue. */
  draft?: { log_id: string; subject: string; body: string } | null;
}

type StatusMsg = { kind: 'ok' | 'warn' | 'err'; text: string };

/** A selectable send target: the lead's own email, or one of its decision-makers. */
interface Recipient { key: string; email: string; label: string; candidateId: string | null }

/** Draft-email modal: template → optional AI personalisation with diff → edit → send to one or more recipients. */
export function EmailComposer({ lead, open, onClose, draft = null }: EmailComposerProps) {
  const { templates } = useTemplates();
  const { currentOrg } = useOrg();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [baseBody, setBaseBody] = useState<string | null>(null); // pre-AI body for the diff
  const [showDiff, setShowDiff] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<'load' | 'ai' | 'send' | 'save' | null>(null);
  const [msg, setMsg] = useState<StatusMsg | null>(null);
  const [decisionMakers, setDecisionMakers] = useState<DecisionMakerCandidate[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set(lead.email ? ['lead'] : []));

  useEffect(() => {
    let cancelled = false;
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', lead.id).not('email', 'is', null).then(({ data }) => {
      if (!cancelled) setDecisionMakers((data as DecisionMakerCandidate[]) ?? []);
    });
    setSelectedRecipients(new Set(lead.email ? ['lead'] : []));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const recipients: Recipient[] = useMemo(() => {
    const list: Recipient[] = [];
    if (lead.email) list.push({ key: 'lead', email: lead.email, label: `${lead.owner_name ?? lead.business_name} (${lead.email})`, candidateId: null });
    for (const dm of decisionMakers) {
      if (!dm.email) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || 'Unknown';
      list.push({ key: dm.id, email: dm.email, label: `${name}${dm.title ? ` — ${dm.title}` : ''} (${dm.email})`, candidateId: dm.id });
    }
    return list;
  }, [lead, decisionMakers]);

  function toggleRecipient(key: string) {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const diff = useMemo(() => (baseBody !== null && showDiff ? diffLines(baseBody, body) : null), [baseBody, body, showDiff]);

  async function generate(useAi: boolean) {
    if (!templateId) return setMsg({ kind: 'err', text: 'Pick a template first.' });
    setBusy(useAi ? 'ai' : 'load'); setMsg(null);
    const { data, error } = await supabase.functions.invoke('generate-email', {
      body: { lead_id: lead.id, template_id: templateId, use_ai: useAi },
    });
    if (error) {
      const text = await readableInvokeError(error);
      setBusy(null);
      return setMsg({ kind: 'err', text });
    }
    setBusy(null);
    const r = data as { subject: string; body: string; ai_used: boolean; missing: string[]; error?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    if (useAi && !r.ai_used) setMsg({ kind: 'warn', text: 'AI unavailable — using the plain template instead.' });
    if (useAi) { setBaseBody(body || null); setShowDiff(true); } else { setBaseBody(r.body); setShowDiff(false); }
    setSubject(r.subject); setBody(r.body); setMissing(r.missing);
  }

  async function send(asDraft: boolean) {
    const targets = recipients.filter((r) => selectedRecipients.has(r.key));
    if (targets.length === 0) return setMsg({ kind: 'err', text: 'Select at least one recipient.' });
    if (!subject.trim() || !body.trim()) return setMsg({ kind: 'err', text: 'Subject and body are required.' });
    setBusy(asDraft ? 'save' : 'send'); setMsg(null);
    let succeeded = 0;
    let firstFailReason: string | null = null;
    for (const target of targets) {
      if (asDraft) {
        const { error } = await supabase.from('email_logs').insert({
          lead_id: lead.id, to_email: target.email, subject, body, status: 'draft',
          decision_maker_candidate_id: target.candidateId,
          sent_by: (await supabase.auth.getUser()).data.user?.id,
          org_id: currentOrg?.id,
        });
        if (error) { if (!firstFailReason) firstFailReason = error.message; continue; }
        succeeded++;
        continue;
      }
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: target.email, subject, body, lead_id: lead.id,
          decision_maker_candidate_id: target.candidateId,
          log_id: targets.length === 1 ? draft?.log_id : undefined,
        },
      });
      if (error) { if (!firstFailReason) firstFailReason = await readableInvokeError(error); continue; }
      const r = data as { ok?: boolean; error?: string };
      if (r.error) { if (!firstFailReason) firstFailReason = r.error; continue; }
      succeeded++;
    }
    setBusy(null);
    if (succeeded === targets.length) {
      setMsg({ kind: 'ok', text: asDraft ? 'Saved to your review queue.' : (targets.length > 1 ? `Sent to ${succeeded} recipients ✓` : 'Sent ✓') });
      if (!asDraft) setTimeout(onClose, 800);
    } else {
      setMsg({ kind: 'err', text: `${succeeded} of ${targets.length} succeeded${firstFailReason ? ` — ${firstFailReason}` : ''}` });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Email — ${lead.business_name}`}>
      <div className="flex flex-col gap-4">
        {recipients.length === 0 && <p role="alert" className="text-sm text-danger">No email addresses available for this lead or its decision-makers.</p>}
        {recipients.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">Send to</p>
            {recipients.map((r) => (
              <label key={r.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedRecipients.has(r.key)} onChange={() => toggleRecipient(r.key)} className="h-4 w-4 accent-violet-500" />
                {r.label}
              </label>
            ))}
          </div>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void generate(false)} disabled={busy !== null} loading={busy === 'load'}>{busy === 'load' ? 'Loading…' : 'Use template'}</Button>
          <Button onClick={() => void generate(true)} disabled={busy !== null} loading={busy === 'ai'}>
            <Sparkles className="h-4 w-4" aria-hidden />{busy === 'ai' ? 'Personalising…' : 'Personalise with AI'}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-warning">No value for: {missing.map((m) => `{{${m}}}`).join(', ')} — those spots are blank, check the draft reads well.</p>
        )}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        {diff && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted"><WandSparkles className="h-3.5 w-3.5" aria-hidden />Template → AI changes</p>
            {diff.map((l, i) => (
              <p key={i} className={`whitespace-pre-wrap ${l.kind === 'added' ? 'text-success' : l.kind === 'removed' ? 'text-danger/70 line-through' : 'text-muted/60'}`}>{l.text || ' '}</p>
            ))}
            <button type="button" onClick={() => setShowDiff(false)} className="mt-1 flex min-h-11 cursor-pointer items-center text-cyan">Hide diff</button>
          </div>
        )}
        <Textarea label="Body (plain text — lands in inboxes better)" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        {msg && (
          <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-danger' : msg.kind === 'warn' ? 'text-warning' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => void send(true)} disabled={busy !== null} loading={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save as draft'}</Button>
          <Button onClick={() => void send(false)} disabled={busy !== null || selectedRecipients.size === 0} loading={busy === 'send'}>
            <Send className="h-4 w-4" aria-hidden />{busy === 'send' ? 'Sending…' : selectedRecipients.size > 1 ? `Send to ${selectedRecipients.size} recipients` : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Run the typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all existing tests still passing (this file exports `diffLines`, which may have its own unit tests already — confirm they still pass unchanged, since `diffLines` itself is untouched).

- [ ] **Step 3: Live-verify in the browser**

Using this project's established temporary-insert-then-cleanup pattern on Mr Brush & Co:
1. Create a temporary lead with a real email, and one temporary Hunter-sourced `decision_maker_candidates` row (with a real email) for it.
2. Open the EmailComposer for that lead — confirm both the lead's own email and the decision-maker checkbox appear, lead's own checked by default.
3. Generate a template draft, check both boxes, click "Save as draft" — confirm two `email_logs` rows are created, one with `decision_maker_candidate_id` null and one with it set to the candidate's id, both with the correct (identical) subject/body.
4. Clean up the temporary lead/candidate and both draft rows created; independently re-verify baseline.

- [ ] **Step 4: Commit**

```bash
git add src/components/emails/EmailComposer.tsx
git commit -m "feat: multi-recipient send in EmailComposer (lead's own email + decision-makers)"
```

---

### Task 9: `BulkDraftModal` — fan out to decision-maker contacts

**Files:**
- Modify: `src/components/pipeline/BulkDraftModal.tsx`

**Interfaces:**
- Consumes: `DecisionMakerCandidate` (Task 2), `generate-email`'s `recipient_name` param (Task 7), `send-email`/`email_logs`'s `decision_maker_candidate_id` (Task 7).
- Produces: nothing new consumed elsewhere in this plan.

- [ ] **Step 1: Add the toggle and per-recipient fan-out**

`src/components/pipeline/BulkDraftModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/Input';

interface BulkDraftModalProps {
  open: boolean;
  leads: Lead[];
  onClose: () => void;
  onGenerated?: () => void;
}

interface RecipientTarget { lead: Lead; email: string; recipientName: string | null; candidateId: string | null }

/**
 * Generates one email draft per recipient from a single shared template,
 * reusing the exact generate-email + email_logs insert path EmailComposer's
 * own "Save as draft" already uses. Leads with no email address of their
 * own are skipped up front unless the "include decision-maker contacts"
 * toggle finds them a recipient another way.
 */
export function BulkDraftModal({ open, leads, onClose, onGenerated }: BulkDraftModalProps) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { templates } = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [includeDecisionMakers, setIncludeDecisionMakers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalTargets, setTotalTargets] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  // The modal stays mounted for the page's lifetime (Modal just returns null
  // while closed), so `summary` would survive a close and permanently hide the
  // Generate button on reopen. Reset it whenever the modal opens — same pattern
  // EnrichmentReview uses for the same reason.
  useEffect(() => {
    if (open) {
      setSummary(null);
      setProgress(0);
      setIncludeDecisionMakers(false);
    }
  }, [open]);

  const leadsWithEmail = leads.filter((l) => l.email);
  const withoutEmailCount = leads.length - leadsWithEmail.length;

  async function buildTargets(): Promise<RecipientTarget[]> {
    const targets: RecipientTarget[] = [];
    for (const lead of leadsWithEmail) targets.push({ lead, email: lead.email!, recipientName: null, candidateId: null });
    if (!includeDecisionMakers) return targets;
    const leadIds = leads.map((l) => l.id);
    const { data } = await supabase.from('decision_maker_candidates').select('*').in('lead_id', leadIds).not('email', 'is', null);
    for (const dm of (data as DecisionMakerCandidate[] | null) ?? []) {
      const lead = leads.find((l) => l.id === dm.lead_id);
      if (!lead) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || null;
      targets.push({ lead, email: dm.email!, recipientName: name, candidateId: dm.id });
    }
    return targets;
  }

  async function handleGenerate() {
    if (!templateId || !currentOrg || !session) return;
    setBusy(true);
    setProgress(0);
    setSummary(null);
    const targets = await buildTargets();
    setTotalTargets(targets.length);
    let drafted = 0;
    let firstFailReason: string | null = null;
    for (const target of targets) {
      const { data, error: invokeErr } = await supabase.functions.invoke('generate-email', {
        body: { lead_id: target.lead.id, template_id: templateId, use_ai: useAi, recipient_name: target.recipientName ?? undefined },
      });
      if (invokeErr) {
        if (!firstFailReason) firstFailReason = await readableInvokeError(invokeErr);
        setProgress((p) => p + 1);
        continue;
      }
      const result = data as { subject?: string; body?: string; error?: string } | null;
      if (result && !result.error && result.subject && result.body) {
        const { error: insertErr } = await supabase.from('email_logs').insert({
          lead_id: target.lead.id, to_email: target.email, subject: result.subject, body: result.body,
          status: 'draft', sent_by: session.user.id, org_id: currentOrg.id,
          decision_maker_candidate_id: target.candidateId,
        });
        if (!insertErr) drafted++;
        else if (!firstFailReason) firstFailReason = insertErr.message;
      } else if (!firstFailReason) {
        firstFailReason = result?.error ?? 'Draft generation failed';
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    const skippedFailed = targets.length - drafted;
    const parts = [`Drafted ${drafted} emails`];
    if (withoutEmailCount > 0 && !includeDecisionMakers) parts.push(`${withoutEmailCount} leads skipped (no email address)`);
    if (skippedFailed > 0) parts.push(`${skippedFailed} failed to draft${firstFailReason ? ` (${firstFailReason})` : ''}`);
    setSummary(parts.join(' — '));
    if (drafted > 0) onGenerated?.();
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft emails">
      <div className="flex flex-col gap-4">
        {withoutEmailCount > 0 && (
          <p className="text-sm text-warning">{withoutEmailCount} of {leads.length} selected leads have no email address of their own{includeDecisionMakers ? '' : ' and will be skipped'}.</p>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Personalise with AI
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeDecisionMakers} onChange={(e) => setIncludeDecisionMakers(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Also include decision-maker contacts
        </label>
        {busy && <p className="text-sm text-muted">{progress} / {totalTargets} drafted…</p>}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleGenerate()} disabled={busy || !templateId || leads.length === 0} loading={busy}>
              {busy ? 'Generating…' : 'Generate drafts'}
            </Button>
          )}
          {summary && (
            <Button onClick={() => { onClose(); navigate('/emails?tab=release'); }}>
              Go to release queue
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

(The Generate button's disabled condition relaxes from `leadsWithEmail.length === 0` to `leads.length === 0`, since with the toggle on, leads with no email of their own can still have valid decision-maker targets — `buildTargets()` correctly reports zero drafted if genuinely nothing is available either way.)

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Live-verify in the browser**

Using this project's established temporary-insert-then-cleanup pattern on Mr Brush & Co:
1. Create two temporary leads — one with its own email, one WITHOUT an email but WITH a temporary Hunter-sourced decision-maker candidate (real email).
2. Select both on the Pipeline List, open "Draft emails", check "Also include decision-maker contacts", generate.
3. Confirm: 2 drafts created total (one for the first lead's own email, one for the second lead's decision-maker), the second draft's `email_logs.decision_maker_candidate_id` is set correctly, and — if AI personalization is on and the org's Gemini key is configured — the second draft's greeting reflects the decision-maker's name, not a blank/lead-derived one.
4. Repeat with the toggle OFF — confirm exactly 1 draft (today's exact original behavior, the lead with no email skipped).
5. Clean up all temporary data (leads, candidate, generated `email_logs` rows), independently re-verify baseline.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/BulkDraftModal.tsx
git commit -m "feat: fan out bulk email drafting to decision-maker contacts"
```

---

### Task 10: `useLinkedinOutreach` — join leads, extend `markSent`

**Files:**
- Modify: `src/hooks/useLinkedinOutreach.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: `LinkedinContact.lead_id`/`decision_maker_candidate_id` (Task 1's migration).
- Produces: `LeadSummary` type, `ContactWithLead` type, `DraftWithContact` type (now including the joined lead) — Task 11 and Task 12 both consume these. `markSent(draft: DraftWithContact): Promise<string | null>` — note the signature change from `markSent(draftId: string, contactId: string)`; Task 12 is the only caller and is updated in this same task's file, but `LinkedinOutreach.tsx`'s existing three call sites (draft/approved states) also need updating here since they already call `markSent`.

- [ ] **Step 1: Add `lead_id`/`decision_maker_candidate_id` to the `LinkedinContact` type**

In `src/types/index.ts`, update the existing `LinkedinContact` interface:

```typescript
export interface LinkedinContact {
  id: string;
  org_id: string;
  full_name: string;
  linkedin_url: string | null;
  context_signal: string | null;
  status: LinkedinContactStatus;
  lead_id: string | null;
  decision_maker_candidate_id: string | null;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Rewrite the hook**

`src/hooks/useLinkedinOutreach.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import type { LinkedinContact, LinkedinDraft } from '../types';

export interface LeadSummary { id: string; business_name: string; pipeline_id: string }
export type ContactWithLead = LinkedinContact & { lead: LeadSummary | null };
export type DraftWithContact = LinkedinDraft & { contact: ContactWithLead };

/** LinkedIn contacts + their drafts for the current org, each joined to its
 * linked lead's summary (null for a manually-added contact with no lead
 * tie) so callers can search/filter by pipeline (see LinkedinOutreach.tsx). */
export function useLinkedinOutreach() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [contacts, setContacts] = useState<ContactWithLead[]>([]);
  const [drafts, setDrafts] = useState<DraftWithContact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [contactsRes, draftsRes] = await Promise.all([
      supabase.from('linkedin_contacts').select('*, lead:leads(id, business_name, pipeline_id)').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      // Include 'approved' so a draft stays visible (with its "Mark as
      // sent" action available) after approval — otherwise it drops out of
      // this query the moment it's approved and its button can never render.
      supabase.from('linkedin_drafts').select('*, contact:linkedin_contacts(*, lead:leads(id, business_name, pipeline_id))').eq('org_id', currentOrg.id).in('status', ['draft', 'approved']).order('created_at', { ascending: false }),
    ]);
    setContacts((contactsRes.data as ContactWithLead[] | null) ?? []);
    setDrafts((draftsRes.data as DraftWithContact[] | null) ?? []);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addContact = useCallback(async (input: { full_name: string; linkedin_url: string; context_signal: string }): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error } = await supabase.from('linkedin_contacts').insert({
      org_id: currentOrg.id, full_name: input.full_name,
      linkedin_url: input.linkedin_url || null, context_signal: input.context_signal || null,
      created_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const draftFor = useCallback(async (contactId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('draft-linkedin-message', { body: { contact_id: contactId } });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [refresh]);

  const approve = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString() }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [session, refresh]);

  const skip = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'skipped' }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  /**
   * Marks a draft sent and, when its contact is linked to a lead, mirrors
   * send-email's own safety-scoped side effects: logs a note and advances
   * the lead from new_lead to contacted specifically (never any other
   * stage), plus bumps last_contacted_at. Takes the full draft object
   * (not just ids) so it has the message text and the linked lead's id
   * without an extra fetch. A contact with no lead tie behaves exactly as
   * today — only its own/the draft's status changes.
   */
  const markSent = useCallback(async (draft: DraftWithContact): Promise<string | null> => {
    const { error: draftErr } = await supabase.from('linkedin_drafts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', draft.id);
    if (draftErr) return draftErr.message;
    await supabase.from('linkedin_contacts').update({ status: 'sent' }).eq('id', draft.contact.id);
    if (draft.contact.lead) {
      const leadId = draft.contact.lead.id;
      const { data: lead } = await supabase.from('leads').select('stage').eq('id', leadId).maybeSingle();
      await supabase.from('lead_notes').insert({
        lead_id: leadId,
        created_by: session?.user.id,
        note_type: 'general',
        content: `LinkedIn message sent to ${draft.contact.full_name}:\n\n${draft.message}`,
      });
      const leadUpdate: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
      if (lead?.stage === 'new_lead') leadUpdate.stage = 'contacted';
      await supabase.from('leads').update(leadUpdate).eq('id', leadId);
    }
    await refresh();
    return null;
  }, [session, refresh]);

  return { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent };
}
```

- [ ] **Step 3: Update `LinkedinOutreach.tsx`'s `markSent` call sites to pass the full draft**

In `src/pages/LinkedinOutreach.tsx`, the two existing "Mark as sent" call sites (both inside `{d.status === 'draft' && ...}`/`{d.status === 'approved' && ...}`) currently call `markSent(d.id, d.contact.id)` — update both to `markSent(d)`:

```tsx
                {d.status === 'approved' && (
                  <Button onClick={() => void (async () => { setBusy(d.id); setError(await markSent(d)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}>Mark as sent</Button>
                )}
```

(This is the only shape of this call site in the current file — there's exactly one, inside the `d.status === 'approved'` branch, per the actual deployed code from the earlier loading-spinner sweep. If a second one exists inside a `d.status === 'draft'` branch by the time this task runs, update it identically.)

- [ ] **Step 4: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Live-verify `markSent`'s lead-side effects**

Using this project's established temporary-insert-then-cleanup pattern on Mr Brush & Co (or DI Dreamlabs, whichever has a spare real user session available):

1. Create a temporary lead with `stage = 'new_lead'`.
2. Create a temporary `linkedin_contacts` row with `lead_id` set to it, and a temporary `linkedin_drafts` row (`status = 'approved'`) for that contact with a real message string.
3. Call `markSent` with the full draft object (matching what the UI would pass) and confirm: the draft's status is `'sent'`, the contact's status is `'sent'`, a new `lead_notes` row exists with the expected content, and the lead's `stage` is now `'contacted'` with `last_contacted_at` set to a recent timestamp.
4. Repeat with a temporary lead whose `stage` is something other than `'new_lead'` (e.g. `'proposal_sent'`) — confirm `markSent` does **not** change that stage, only `last_contacted_at` and the note.
5. Repeat once more with a `linkedin_contacts` row that has `lead_id: null` — confirm `markSent` still correctly marks the draft/contact sent, with no `lead_notes` row created and no `leads` table touched at all.
6. Fully clean up every temporary row created across all three scenarios; independently re-verify baseline.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useLinkedinOutreach.ts src/pages/LinkedinOutreach.tsx src/types/index.ts
git commit -m "feat: join leads into LinkedIn contacts/drafts, extend markSent to update the linked lead"
```

---

### Task 11: LinkedIn queue — search and pipeline filter

**Files:**
- Modify: `src/pages/LinkedinOutreach.tsx`

**Interfaces:**
- Consumes: `ContactWithLead`, `DraftWithContact` (Task 10), `usePipeline()`'s existing `pipelines` list.
- Produces: nothing new consumed by a later task in this plan (Task 12 adds to the same file but to a different, independent part of the render).

- [ ] **Step 1: Rewrite the file with search, pipeline filter, and the filtered lists wired through the render**

`src/pages/LinkedinOutreach.tsx` — full replacement:

```tsx
import { useState } from 'react';
import { Contact as LinkedinIcon, CheckCircle2, ExternalLink, Sparkles, SkipForward } from 'lucide-react';
import { useLinkedinOutreach } from '../hooks/useLinkedinOutreach';
import { usePipeline } from '../hooks/usePipeline';
import { useOrg } from '../hooks/useOrg';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField, Textarea } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

/** LinkedIn contacts + drafts review queue (SPEC.md §2 Channel 2). */
export function LinkedinOutreach() {
  const { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent } = useLinkedinOutreach();
  const { pipelines } = usePipeline();
  const { currentOrg } = useOrg();
  const [form, setForm] = useState({ full_name: '', linkedin_url: '', context_signal: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState(''); // '' = all, 'unlinked' = no lead_id, else a pipeline id

  async function handleAdd() {
    if (!form.full_name.trim()) return;
    setBusy('add'); setError(null);
    const err = await addContact(form);
    setBusy(null);
    if (err) setError(err);
    else setForm({ full_name: '', linkedin_url: '', context_signal: '' });
  }

  const pendingContacts = contacts.filter((c) => c.status === 'pending');
  const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg?.id);

  function matchesSearchAndPipeline(fullName: string, lead: { business_name: string; pipeline_id: string } | null): boolean {
    const q = search.trim().toLowerCase();
    if (q && !fullName.toLowerCase().includes(q) && !(lead?.business_name.toLowerCase().includes(q))) return false;
    if (pipelineFilter === 'unlinked') return !lead;
    if (pipelineFilter && lead?.pipeline_id !== pipelineFilter) return false;
    return true;
  }

  const filteredPendingContacts = pendingContacts.filter((c) => matchesSearchAndPipeline(c.full_name, c.lead));
  const filteredDrafts = drafts.filter((d) => matchesSearchAndPipeline(d.contact.full_name, d.contact.lead));

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <LinkedinIcon className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">LinkedIn outreach</h1>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Contact or company name" className="max-w-xs" />
        <SelectField label="Pipeline" value={pipelineFilter} onChange={(e) => setPipelineFilter(e.target.value)} className="max-w-xs">
          <option value="">All</option>
          <option value="unlinked">Unlinked</option>
          {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Add a contact</p>
          <Input label="Full name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          <Input label="LinkedIn URL (optional)" value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
          <Textarea label="Context signal (optional — a recent post, job change, etc.)" value={form.context_signal} onChange={(e) => setForm((f) => ({ ...f, context_signal: e.target.value }))} />
          <Button onClick={() => void handleAdd()} disabled={busy === 'add' || !form.full_name.trim()} loading={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add contact'}</Button>
        </div>
      </Card>

      {filteredPendingContacts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Not yet drafted</p>
            {filteredPendingContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
                <span className="font-semibold">{c.full_name}</span>
                <Button variant="secondary" onClick={() => void (async () => { setBusy(c.id); setError(await draftFor(c.id)); setBusy(null); })()} disabled={busy === c.id}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === c.id ? 'Drafting…' : 'Draft message'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <p className="font-semibold">Review queue</p>
        {filteredDrafts.length === 0 && (
          <EmptyState icon={LinkedinIcon} title="No drafts waiting" hint="Add a contact and draft a message to see it here." />
        )}
        {filteredDrafts.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{d.contact.full_name}</p>
                {d.contact.linkedin_url && (
                  <a href={d.contact.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-cyan">
                    Open profile <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{d.message}</p>
              <div className="flex gap-2">
                {d.status === 'draft' && (
                  <>
                    <Button onClick={() => void (async () => { setBusy(d.id); setError(await approve(d.id)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve</Button>
                    <Button variant="ghost" onClick={() => void (async () => { setBusy(d.id); setError(await skip(d.id)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}><SkipForward className="h-4 w-4" aria-hidden /> Skip</Button>
                  </>
                )}
                {d.status === 'approved' && (
                  <Button onClick={() => void (async () => { setBusy(d.id); setError(await markSent(d)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}>Mark as sent</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

(This subsumes Task 10 Step 3's single-line `markSent(d.id, d.contact.id)` → `markSent(d)` change, already reflected above — if Task 10 already landed it, this replacement is idempotent.)

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Live-verify in the browser**

Using this project's established temporary-insert-then-cleanup pattern:
1. Create one temporary `linkedin_contacts` row linked to a real (temporary) lead in a known pipeline, and confirm searching by that lead's business name finds it, and selecting that pipeline in the filter shows it while selecting a different pipeline hides it.
2. Confirm an existing manually-added contact with no `lead_id` shows only under the "Unlinked" filter option, not under any real pipeline, and still shows under "All".
3. Clean up the temporary lead/contact; independently re-verify baseline.

- [ ] **Step 4: Commit**

```bash
git add src/pages/LinkedinOutreach.tsx
git commit -m "feat: add search and pipeline filter to the LinkedIn outreach queue"
```

---

### Task 12: LinkedIn queue — multi-select and bulk drafting

**Files:**
- Modify: `src/pages/LinkedinOutreach.tsx`

**Interfaces:**
- Consumes: `useLinkedinOutreach()`'s existing `draftFor` (unchanged signature), `filteredPendingContacts` (Task 11).
- Produces: nothing new consumed elsewhere in this plan — this is the last task.

- [ ] **Step 1: Add selection state and the bulk-draft handler**

Add state alongside the existing `busy`/`error`:

```typescript
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDrafting, setBulkDrafting] = useState(false);
```

Add the handler (near `handleAdd`):

```typescript
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkDraft() {
    setBulkDrafting(true);
    setError(null);
    let drafted = 0;
    let firstFailReason: string | null = null;
    for (const contactId of selected) {
      const err = await draftFor(contactId);
      if (err) { if (!firstFailReason) firstFailReason = err; continue; }
      drafted++;
    }
    setBulkDrafting(false);
    setSelected(new Set());
    if (drafted < selected.size) setError(`Drafted ${drafted} of ${selected.size}${firstFailReason ? ` — ${firstFailReason}` : ''}`);
  }
```

(Sequential, matching `BulkDraftModal`'s own established loop pattern in this codebase — each call is a real Anthropic API call via `draft-linkedin-message`, and `draftFor` already calls `refresh()` internally on every success, which is cheap enough at this scale to not need debouncing/batching.)

- [ ] **Step 2: Add checkboxes and the bulk-draft button to the "Not yet drafted" list**

Replace the "Not yet drafted" card's contents:

```tsx
      {filteredPendingContacts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Not yet drafted</p>
              {selected.size > 0 && (
                <Button variant="secondary" onClick={() => void handleBulkDraft()} disabled={bulkDrafting} loading={bulkDrafting}>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {bulkDrafting ? 'Drafting…' : `Draft messages (${selected.size})`}
                </Button>
              )}
            </div>
            {filteredPendingContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} className="h-4 w-4 accent-violet-500" />
                  <span className="font-semibold">{c.full_name}</span>
                </label>
                <Button variant="secondary" onClick={() => void (async () => { setBusy(c.id); setError(await draftFor(c.id)); setBusy(null); })()} disabled={busy === c.id}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === c.id ? 'Drafting…' : 'Draft message'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
```

(The existing single-contact "Draft message" button stays, for drafting just one without selecting it — the two actions are independent and don't conflict.)

- [ ] **Step 3: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Live-verify in the browser**

Using this project's established temporary-insert-then-cleanup pattern:
1. Create 2 temporary pending `linkedin_contacts` rows (org-level, no `lead_id` needed for this specific test).
2. Select both via their checkboxes, confirm "Draft messages (2)" appears, click it.
3. Confirm both now have real drafts in the "Review queue" section (each a genuine Anthropic-drafted message, matching this project's established live-verification-over-mocking style — do not mock the AI call), and the pending list's selection is cleared afterward.
4. Clean up both temporary contacts and their generated drafts; independently re-verify baseline.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LinkedinOutreach.tsx
git commit -m "feat: multi-select and bulk drafting in the LinkedIn outreach queue"
```
