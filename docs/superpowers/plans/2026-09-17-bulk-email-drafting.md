# Bulk Email Drafting + Release Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user multi-select leads on the Pipeline, generate an email
draft per lead from one shared template in a single bulk action, then
multi-select-release (send) those drafts from a new "Waiting to release"
section on the Emails page.

**Architecture:** A new modal component loops the existing single-lead
`generate-email` call + `email_logs` insert (unchanged) across every
selected lead with an email address. A new page section reuses the
Dashboard's existing draft-queue data (`useDrafts()`) and display component
(`EmailReviewQueue`, extended with optional multi-select props — additive,
not a rewrite) with a bulk "Release" action that loops the existing
`send-email` call (unchanged). One real, pre-existing gap gets fixed at the
source: no send path currently updates `leads.last_contacted_at`.

**Tech Stack:** Supabase Edge Functions (Deno) — none created, one modified.
React 18 + TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-16-bulk-email-drafting-design.md`

## Global Constraints

- Reuse, don't rebuild: `generate-email`, `send-email`, and the
  `email_logs` `'draft'`/`'failed'`/`'sent'` status model are all consumed
  exactly as they exist today — no changes to their request/response
  contracts.
- A bulk-generated draft's `sent_by` is always the person who ran the bulk
  action, never the lead's `assigned_to` — matching `EmailComposer`'s
  existing "Save as draft" behavior exactly.
- Nothing sends without an explicit "Release selected" click — generation
  only ever produces `status: 'draft'` rows.
- The Dashboard's existing "Emails ready to review" card must keep working
  exactly as it does today — the new multi-select capability is additive
  and opt-in via new optional props, never a breaking change to that
  existing usage.
- This plan depends on the already-complete bulk-lead-enrichment plan's
  multi-select work (`selected: Set<string>` state and toggle handlers on
  `PipelineList.tsx`/`ListTable.tsx`) — already present in this branch, not
  something this plan adds.
- This codebase has no Deno-side unit test harness and no DOM/jsdom test
  environment for React components — Deno/edge-function logic is verified
  by deploying and invoking it for real (or, where a real success can't be
  triggered without impersonating a specific real user's credentials, by
  directly verifying the exact SQL/logic the code runs inside a
  rolled-back transaction) and frontend behavior is verified live in the
  browser (Chrome MCP tools are available), never via a new React
  component-test file — this repo has none and the plan this one depends
  on established that convention deliberately, not by omission.

---

### Task 1: Fix `send-email` to update `leads.last_contacted_at` and stage

**Files:**
- Modify: `supabase/functions/send-email/index.ts`

**Interfaces:**
- No new exports — this is an internal behavior fix inside the existing
  `Deno.serve` handler. Produces: every successful send through this
  function (manual composer sends, sequence-driven sends, and this plan's
  new bulk release in Task 3) now updates the lead's `last_contacted_at`,
  and advances `stage` from `new_lead` to `contacted` specifically.

- [ ] **Step 1: Add the lead-update block**

In `supabase/functions/send-email/index.ts`, the function currently ends
with:

```typescript
  const warning = logFailed ? 'Email sent but logging failed' : undefined;
  if (status === 'failed') return json({ error: 'Send failed: ' + errorMessage, log_id: logId, ...(warning ? { warning } : {}) }, 400, headers);
  return json({ ok: true, log_id: logId, ...(warning ? { warning } : {}) }, 200, headers);
});
```

Insert a new block immediately before the `const warning = ...` line:

```typescript
  // Best-effort: update the lead's last-contacted timestamp on every
  // successful send through this function (manual, sequence, or bulk
  // release) — and advance a brand-new lead to "contacted" specifically,
  // never touching any other stage so a reply to an already-advanced lead
  // is never silently reset backward. A failure here must not turn a
  // successful send into an error response — the email already sent and
  // logged either way.
  if (status === 'sent' && body.lead_id) {
    const { data: currentLead } = await service.from('leads').select('stage').eq('id', body.lead_id).maybeSingle();
    const leadUpdate: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
    if (currentLead?.stage === 'new_lead') leadUpdate.stage = 'contacted';
    await service.from('leads').update(leadUpdate).eq('id', body.lead_id);
  }

  const warning = logFailed ? 'Email sent but logging failed' : undefined;
  if (status === 'failed') return json({ error: 'Send failed: ' + errorMessage, log_id: logId, ...(warning ? { warning } : {}) }, 400, headers);
  return json({ ok: true, log_id: logId, ...(warning ? { warning } : {}) }, 200, headers);
});
```

- [ ] **Step 2: Deploy**

Check `send-email`'s current stored file layout via
`mcp__plugin_supabase_supabase__get_edge_function` (project id
`wgomksxelyfkzepbnkdd`) first, and reproduce that exact layout when
redeploying via `deploy_edge_function`.

- [ ] **Step 3: Live-verify the failed-send path for real**

This project has exactly ONE real user with verified SMTP settings
(`user_email_settings.is_verified = true`) — you cannot sign in as them
without their password, and doing so would violate this project's core
safety rules (never authenticate as a real person). Do NOT attempt to.

Instead, create a throwaway test user with its OWN fake (never-real)
`user_email_settings` row, so the code reaches past the early
`is_verified` gate and genuinely attempts (and fails) a real SMTP send —
this proves the new code correctly does NOT touch `leads` when
`status !== 'sent'`, without impersonating anyone:

```sql
-- 1. Throwaway auth user (standard pattern for this project)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, recovery_sent_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'sdd-t1-verify@example.com', crypt('SddVerify123!', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
) returning id;

-- 2. Fake, never-real SMTP settings that will genuinely fail to connect —
--    use the id returned above.
insert into user_email_settings (user_id, smtp_host, smtp_port, smtp_user, from_name, is_verified)
values ('<id>', 'smtp.invalid.example', 587, 'nobody@example.com', 'Test', true);
select app_set_smtp_secret('<id>', 'not-a-real-password');
```

Sign in via password grant (`curl -s -X POST
"https://wgomksxelyfkzepbnkdd.supabase.co/auth/v1/token?grant_type=password"
-H "apikey: <VITE_SUPABASE_ANON_KEY from .env>" -H "Content-Type:
application/json" -d '{"email":"sdd-t1-verify@example.com","password":"SddVerify123!"}'`),
then invoke `send-email` with a real lead's id and email
(`select id, email, org_id from leads where email is not null limit 1;`) —
the send will fail (unreachable host), giving a real `status: 'failed'`
response. Confirm via `select last_contacted_at, stage from leads where id
= '<that lead id>'` that neither field changed. Clean up the throwaway user
and their `user_email_settings` row afterward.

- [ ] **Step 4: Verify the update logic itself via a rolled-back transaction**

The positive "sent" path can't be triggered live without impersonating the
one real verified user, so verify the exact logic directly against a real
lead, inside a transaction you roll back (never commit):

```sql
BEGIN;
-- Case A: a new_lead advances to contacted alongside the timestamp
update leads set stage = 'new_lead' where id = '<test lead id>';
-- (this mirrors exactly what the new code block does)
update leads set last_contacted_at = now(), stage = 'contacted' where id = '<test lead id>' and stage = 'new_lead';
select stage, last_contacted_at from leads where id = '<test lead id>'; -- expect stage='contacted', timestamp set
ROLLBACK;

BEGIN;
-- Case B: any other stage only gets the timestamp, stage is untouched
update leads set stage = 'negotiating' where id = '<test lead id>';
update leads set last_contacted_at = now() where id = '<test lead id>'; -- code's actual conditional only adds stage when currentLead.stage === 'new_lead'
select stage, last_contacted_at from leads where id = '<test lead id>'; -- expect stage='negotiating' (unchanged), timestamp set
ROLLBACK;
```

Confirm both cases produce the expected result, then confirm the ROLLBACK
actually reverted the test lead's real stage via one final `select stage
from leads where id = '<test lead id>'` outside any transaction.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "fix: update leads.last_contacted_at and stage on every successful send"
```

---

### Task 2: Add optional multi-select to `EmailReviewQueue`

**Files:**
- Modify: `src/components/dashboard/EmailReviewQueue.tsx`

**Interfaces:**
- Produces: three new OPTIONAL props — `selected?: Set<string>`, `onToggle?:
  (id: string) => void`, `onToggleAll?: () => void` — consumed by Task 3's
  `ReleaseQueue`. When all three are omitted (the Dashboard's existing
  usage, untouched by this task), the component renders exactly as it does
  today — no checkboxes, no behavior change.

- [ ] **Step 1: Add the optional props and checkbox rendering**

Current file:

```tsx
import { MailCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { DraftLog } from '../../hooks/useDrafts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailReviewQueueProps {
  drafts: DraftLog[];
  loading: boolean;
  onReview: (draft: DraftLog) => void;
  onChanged: () => void;
}

/** Drafts awaiting review — sequence output + manual saves. Nothing sends without a click. */
export function EmailReviewQueue({ drafts, loading, onReview, onChanged }: EmailReviewQueueProps) {
  if (loading) return <Skeleton className="h-20 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState icon={MailCheck} title="No emails waiting for review" hint="Sequence drafts and saved drafts appear here for you to approve." />;
  }
  async function discard(id: string) {
    await supabase.from('email_logs').delete().eq('id', id);
    onChanged();
  }
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
          <span className="font-heading text-sm font-bold">{d.lead?.business_name ?? d.to_email}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.sequence_enrollment_id ? 'bg-violet/25 text-offwhite' : 'bg-surface text-muted'}`}>
            {d.sequence_enrollment_id ? 'Sequence' : 'Manual'}
          </span>
          {d.status === 'failed' && (
            <span title={d.error_message ?? 'Send failed'} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
              Failed — retry
            </span>
          )}
          <span className="w-full truncate text-sm text-muted sm:w-auto sm:flex-1">{d.subject}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void discard(d.id)} aria-label="Discard draft" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
            <Button variant="secondary" onClick={() => onReview(d)}>Review &amp; send</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

Change to:

```tsx
import { MailCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { DraftLog } from '../../hooks/useDrafts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailReviewQueueProps {
  drafts: DraftLog[];
  loading: boolean;
  onReview: (draft: DraftLog) => void;
  onChanged: () => void;
  /** Optional multi-select — when all three are provided, a header
   * "select all" row and a per-row checkbox render alongside the existing
   * content. Omitted entirely by the Dashboard's own usage, which renders
   * exactly as before. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
}

/** Drafts awaiting review — sequence output + manual saves. Nothing sends without a click. */
export function EmailReviewQueue({ drafts, loading, onReview, onChanged, selected, onToggle, onToggleAll }: EmailReviewQueueProps) {
  if (loading) return <Skeleton className="h-20 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState icon={MailCheck} title="No emails waiting for review" hint="Sequence drafts and saved drafts appear here for you to approve." />;
  }
  async function discard(id: string) {
    await supabase.from('email_logs').delete().eq('id', id);
    onChanged();
  }
  const selectable = selected !== undefined && onToggle !== undefined && onToggleAll !== undefined;
  return (
    <ul className="flex flex-col gap-2">
      {selectable && (
        <li className="flex items-center gap-2 px-1">
          <input type="checkbox" checked={drafts.length > 0 && selected.size === drafts.length} onChange={onToggleAll} className="h-4 w-4 accent-violet-500" aria-label="Select all" />
          <span className="text-xs font-semibold text-muted">Select all</span>
        </li>
      )}
      {drafts.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
          {selectable && (
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} className="h-4 w-4 accent-violet-500" aria-label={`Select ${d.lead?.business_name ?? d.to_email}`} />
          )}
          <span className="font-heading text-sm font-bold">{d.lead?.business_name ?? d.to_email}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.sequence_enrollment_id ? 'bg-violet/25 text-offwhite' : 'bg-surface text-muted'}`}>
            {d.sequence_enrollment_id ? 'Sequence' : 'Manual'}
          </span>
          {d.status === 'failed' && (
            <span title={d.error_message ?? 'Send failed'} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
              Failed — retry
            </span>
          )}
          <span className="w-full truncate text-sm text-muted sm:w-auto sm:flex-1">{d.subject}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void discard(d.id)} aria-label="Discard draft" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
            <Button variant="secondary" onClick={() => onReview(d)}>Review &amp; send</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Typecheck and run the existing suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean — this component has no existing test file, and the
change is additive/optional so nothing else should break.

- [ ] **Step 3: Live-verify the Dashboard is unaffected**

Navigate to `/` (Dashboard) in the browser at `http://localhost:5173`
(start with `npm run dev` from this worktree if not already running).
Confirm the "Emails ready to review" card renders exactly as before — no
checkboxes, "Review & send"/discard still work. (Task 3 will add the
selectable usage elsewhere; this step only confirms the existing,
non-selectable usage is unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/EmailReviewQueue.tsx
git commit -m "feat: add optional multi-select to EmailReviewQueue"
```

---

### Task 3: Release queue tab on the Emails page

**Files:**
- Create: `src/components/emails/ReleaseQueue.tsx`
- Modify: `src/pages/EmailsHub.tsx`

**Interfaces:**
- Consumes: `EmailReviewQueue`'s new optional props (Task 2), `useDrafts()`
  (existing, unchanged), `useOrgLeads()` (existing, unchanged — used the
  same way `Dashboard.tsx` already uses it to resolve the lead for "Review
  & send"), `send-email` (existing, unchanged).
- Produces: nothing new consumed by a later task — this is a leaf UI
  feature.

- [ ] **Step 1: Write `ReleaseQueue.tsx`**

`src/components/emails/ReleaseQueue.tsx`:

```tsx
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useDrafts } from '../../hooks/useDrafts';
import type { DraftLog } from '../../hooks/useDrafts';
import { useOrgLeads } from '../../hooks/useOrgLeads';
import { Button } from '../ui/Button';
import { EmailReviewQueue } from '../dashboard/EmailReviewQueue';
import { EmailComposer } from './EmailComposer';

/**
 * Same underlying draft queue as the Dashboard's "Emails ready to review"
 * card, but with multi-select + bulk "Release" for working through a
 * larger batch — an additional way to act on many drafts at once, not a
 * replacement for the Dashboard's quick one-by-one triage.
 */
export function ReleaseQueue() {
  const { drafts, loading, refresh } = useDrafts();
  const { leads } = useOrgLeads();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<DraftLog | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const reviewLead = reviewing?.lead ? leads.find((l) => l.id === reviewing.lead!.id) ?? null : null;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id))));
  }

  async function handleRelease() {
    setReleasing(true);
    setSummary(null);
    let sent = 0;
    let failed = 0;
    for (const draft of drafts) {
      if (!selected.has(draft.id)) continue;
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { to_email: draft.to_email, subject: draft.subject, body: draft.body, lead_id: draft.lead?.id, log_id: draft.id },
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || !result?.ok) failed++; else sent++;
    }
    setReleasing(false);
    setSelected(new Set());
    setSummary(failed === 0 ? `Sent ${sent}` : `Sent ${sent} — ${failed} failed (stays in the queue, marked Failed)`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-end">
          <Button onClick={() => void handleRelease()} disabled={releasing}>
            {releasing ? 'Releasing…' : `Release selected (${selected.size})`}
          </Button>
        </div>
      )}
      {summary && <p role="status" className="text-sm text-success">{summary}</p>}
      <EmailReviewQueue
        drafts={drafts}
        loading={loading}
        onReview={setReviewing}
        onChanged={() => void refresh()}
        selected={selected}
        onToggle={toggleSelected}
        onToggleAll={toggleSelectAll}
      />
      {reviewing && reviewLead && (
        <EmailComposer
          lead={reviewLead}
          open
          onClose={() => { setReviewing(null); void refresh(); }}
          draft={{ log_id: reviewing.id, subject: reviewing.subject, body: reviewing.body }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the fourth tab into `EmailsHub.tsx`**

Current file:

```tsx
import { useSearchParams } from 'react-router';
import { TemplateList } from '../components/emails/TemplateList';
import { SequenceList } from '../components/emails/SequenceList';
import { EmailLogList } from '../components/emails/EmailLogList';

const TABS = [
  { key: 'templates', label: 'Templates' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'logs', label: 'Logs' },
] as const;

/** /emails — templates / sequences / logs tabs (SPEC.md §13 routes collapsed to one hub). */
export function EmailsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'templates';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-extrabold">Emails</h1>
      <div className="flex overflow-hidden rounded-lg border border-line self-start" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-11 cursor-pointer px-5 text-sm font-semibold ${tab === t.key ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'templates' && <TemplateList />}
      {tab === 'sequences' && <SequenceList />}
      {tab === 'logs' && <EmailLogList />}
    </div>
  );
}
```

Becomes:

```tsx
import { useSearchParams } from 'react-router';
import { TemplateList } from '../components/emails/TemplateList';
import { SequenceList } from '../components/emails/SequenceList';
import { ReleaseQueue } from '../components/emails/ReleaseQueue';
import { EmailLogList } from '../components/emails/EmailLogList';

const TABS = [
  { key: 'templates', label: 'Templates' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'release', label: 'Waiting to release' },
  { key: 'logs', label: 'Logs' },
] as const;

/** /emails — templates / sequences / release / logs tabs (SPEC.md §13 routes collapsed to one hub). */
export function EmailsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'templates';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-extrabold">Emails</h1>
      <div className="flex overflow-hidden rounded-lg border border-line self-start" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-11 cursor-pointer px-5 text-sm font-semibold ${tab === t.key ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'templates' && <TemplateList />}
      {tab === 'sequences' && <SequenceList />}
      {tab === 'release' && <ReleaseQueue />}
      {tab === 'logs' && <EmailLogList />}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and run the existing suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 4: Live-verify in the browser**

Navigate to `/emails?tab=release`, confirm the "Waiting to release" tab is
selected and shows the same drafts the Dashboard's "Emails ready to
review" card shows (compare against `/` in another check). Select one
draft's checkbox, confirm "Release selected (1)" appears; click "select
all", confirm it toggles every row; click it again to deselect. If there
are no real drafts to test against yet, create one first via the existing
single-lead flow (any lead's `EmailComposer` → "Save as draft") so there's
a real row to select — do not fabricate UI state, use a real draft.

If a real draft exists and you're comfortable releasing it as part of this
verification (using the one real verified-SMTP account, i.e. only if
you're already signed in as that real user in this browser session —
never sign in as them yourself), release it and confirm: the summary line
appears, the row disappears from the "Waiting to release" list, and
`select status, last_contacted_at, stage from email_logs join leads on
leads.id = email_logs.lead_id where email_logs.id = '<that id>'` shows
`status = 'sent'` and confirms Task 1's fix fired for real, closing the
loop on both tasks together. If no real send is possible in this session,
skip the send itself and say so explicitly in your report — the checkbox
mechanics above are still real, live-verified evidence for this task's
own scope.

- [ ] **Step 5: Commit**

```bash
git add src/components/emails/ReleaseQueue.tsx src/pages/EmailsHub.tsx
git commit -m "feat: add release queue tab to the Emails page"
```

---

### Task 4: Bulk-generate drafts from the Pipeline

**Files:**
- Create: `src/components/pipeline/BulkDraftModal.tsx`
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Consumes: `useTemplates()` (existing, unchanged), `generate-email`
  (existing, unchanged), `useOrg()`/`useAuth()` (existing), the `selected`
  multi-select state already on `PipelineList.tsx`.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write `BulkDraftModal.tsx`**

`src/components/pipeline/BulkDraftModal.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { supabase } from '../../lib/supabase';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/Input';

interface BulkDraftModalProps {
  open: boolean;
  leads: Lead[];
  onClose: () => void;
}

/**
 * Generates one email draft per selected lead from a single shared
 * template, reusing the exact generate-email + email_logs insert path
 * EmailComposer's own "Save as draft" already uses. Leads with no email
 * address are skipped up front, not failed mid-loop.
 */
export function BulkDraftModal({ open, leads, onClose }: BulkDraftModalProps) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { templates } = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  const withEmail = leads.filter((l) => l.email);
  const withoutEmailCount = leads.length - withEmail.length;

  async function handleGenerate() {
    if (!templateId || !currentOrg || !session) return;
    setBusy(true);
    setProgress(0);
    setSummary(null);
    let drafted = 0;
    for (const lead of withEmail) {
      const { data } = await supabase.functions.invoke('generate-email', {
        body: { lead_id: lead.id, template_id: templateId, use_ai: useAi },
      });
      const result = data as { subject?: string; body?: string; error?: string } | null;
      if (result && !result.error && result.subject && result.body) {
        const { error: insertErr } = await supabase.from('email_logs').insert({
          lead_id: lead.id, to_email: lead.email, subject: result.subject, body: result.body,
          status: 'draft', sent_by: session.user.id, org_id: currentOrg.id,
        });
        if (!insertErr) drafted++;
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    const skippedFailed = withEmail.length - drafted;
    const parts = [`Drafted ${drafted} emails`];
    if (withoutEmailCount > 0) parts.push(`${withoutEmailCount} skipped (no email address)`);
    if (skippedFailed > 0) parts.push(`${skippedFailed} failed to draft`);
    setSummary(parts.join(' — '));
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft emails">
      <div className="flex flex-col gap-4">
        {withoutEmailCount > 0 && (
          <p className="text-sm text-warning">{withoutEmailCount} of {leads.length} selected leads have no email address and will be skipped.</p>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Personalise with AI
        </label>
        {busy && <p className="text-sm text-muted">{progress} / {withEmail.length} drafted…</p>}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleGenerate()} disabled={busy || !templateId || withEmail.length === 0}>
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

- [ ] **Step 2: Wire it into `PipelineList.tsx`**

Add to the existing imports:

```typescript
import { Send } from 'lucide-react';
import { BulkDraftModal } from '../components/pipeline/BulkDraftModal';
```

(`Send` joins the existing `Inbox, Plus, Radar` import from `lucide-react`
— add it to that same import line rather than a separate one.)

Add state, near the other `useState` calls (after `reviewOpen`):

```typescript
  const [draftModalOpen, setDraftModalOpen] = useState(false);
```

Add the toolbar button, in the same `<div className="flex items-center
gap-3">` that already holds `<ViewToggle>`, the "Fill missing details"
button, and "Add lead" — place it right after "Fill missing details":

```tsx
          {selected.size > 0 && (
            <Button variant="secondary" onClick={() => setDraftModalOpen(true)}>
              <Send className="h-4 w-4" aria-hidden />
              {`Draft emails (${selected.size})`}
            </Button>
          )}
```

Render the modal at the bottom, alongside the other modals, passing the
selected leads resolved from `leadsById` (already computed in this file):

```tsx
      <BulkDraftModal
        open={draftModalOpen}
        leads={[...selected].map((id) => leadsById[id]).filter((l): l is Lead => l !== undefined)}
        onClose={() => setDraftModalOpen(false)}
      />
```

- [ ] **Step 3: Typecheck and run the existing suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 4: Live-verify end to end in the browser**

Navigate to `/pipeline` (List view), select 2-3 real leads that have an
email address (query `select id, business_name, email from leads where
org_id = '<org id>' and email is not null limit 3;` to find good
candidates), click "Draft emails (N)", pick a real template, leave
"Personalise with AI" checked, click "Generate drafts". Confirm the
progress line advances and a summary appears (e.g. "Drafted 3 emails").
Click "Go to release queue", confirm it navigates to `/emails?tab=release`
and the newly-drafted emails appear there (proving this task's output
feeds correctly into Task 3's queue). Also select at least one lead WITH
NO email address alongside leads that do have one, confirm the modal shows
the correct "N of M selected leads have no email address" disclosure and
the generated count matches only the leads with an email.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/BulkDraftModal.tsx src/pages/PipelineList.tsx
git commit -m "feat: wire bulk email drafting into the Pipeline list"
```
