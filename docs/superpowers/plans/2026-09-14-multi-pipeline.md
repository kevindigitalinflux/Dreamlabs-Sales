# Multi-Pipeline Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create, own, and share named pipelines of leads — replacing the
implicit "one bucket per org" model with pipeline-scoped leads, while every existing
org keeps working exactly as it does today via an auto-created "Default Pipeline".

**Architecture:** A new `pipelines` table (org-owned, named) and `pipeline_shares`
table (per-user grants, `view`/`edit`) sit alongside the existing `leads` table, which
gains a `pipeline_id` column. Four `SECURITY DEFINER` SQL functions
(`can_view_pipeline`/`can_edit_pipeline` for pipeline metadata,
`can_view_lead`/`can_edit_lead` for lead rows) replace the org-level RLS policies.
"Edit" permission on a shared pipeline never grants a live cross-org write — it only
unlocks an on-demand fork (a one-time copy into the recipient's own org), which is
what keeps every AI/autopilot cost inside the org that actually owns the data being
worked.

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres + RLS + Deno edge
functions), Vitest, Tailwind v4 (existing design tokens only).

**Spec:** `docs/superpowers/specs/2026-09-14-multi-pipeline-design.md`

## Global Constraints

- Named pipelines are private until explicitly shared (owner + org admins only);
  the auto-created Default Pipeline preserves today's exact per-lead
  `created_by`/`assigned_to` visibility for every org member, unchanged.
- Cross-org sharing is admin-to-admin only, done via a specific person's email — never
  "share with an entire org." Within-org sharing needs no admin restriction (any
  pipeline owner can share with any teammate).
- Neither `view` nor `edit` permission ever grants a live write on a pipeline the
  recipient doesn't own. `edit` only unlocks "Make my own copy" (fork) — an on-demand
  action, not automatic at share time, with a prominent, persistent CTA (not tucked
  into a menu).
- A forked pipeline is a completely independent copy, owned by the forker's own org,
  using that org's own resources for everything going forward — nothing propagates
  back to the source, and the source is never modified.
- `scrape_jobs`/`raw_leads` stay purely org-scoped — unaffected by this plan.
- TypeScript strict mode, named exports only, Tailwind utility classes only (no
  custom CSS, no new colors beyond what already exists in `src/index.css`).
- Autopilot only ever runs against pipelines the acting org owns outright — enforced
  structurally by the RLS write-block (no separate code needed this plan; noted for
  the future autopilot-integration plan).

---

### Task 1: Pipelines schema, RLS, and default-pipeline migration

**Files:**
- Create: `supabase/migrations/018_pipelines.sql`

**Interfaces:**
- Produces: tables `pipelines(id, org_id, name, is_default, created_by, created_at)`
  and `pipeline_shares(id, pipeline_id, shared_with_user_id, permission, shared_by, created_at)`;
  columns `leads.pipeline_id` (`NOT NULL` after backfill) and
  `leads.forked_from_lead_id` (nullable); functions `can_view_pipeline(UUID)`,
  `can_edit_pipeline(UUID)`, `can_view_lead(UUID)`, `can_edit_lead(UUID)`,
  `can_insert_lead_into(UUID)`, all `SQL SECURITY DEFINER STABLE`. Every later task
  in this plan depends on this schema existing.

- [ ] **Step 1: Write the migration file**

```sql
-- Multi-pipeline support: named, ownable, shareable groupings of leads. See
-- docs/superpowers/specs/2026-09-14-multi-pipeline-design.md for the full design.

CREATE TABLE pipelines (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_shares (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id         UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES profiles(id),
  permission          TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  shared_by           UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pipeline_id, shared_with_user_id)
);

ALTER TABLE leads ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE leads ADD COLUMN forked_from_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- One "Default Pipeline" per existing org, every existing lead backfilled into it.
DO $$
DECLARE
  org_row RECORD;
  new_pipeline_id UUID;
BEGIN
  FOR org_row IN SELECT id FROM organizations LOOP
    INSERT INTO pipelines (org_id, name, is_default, created_by)
    VALUES (org_row.id, 'Default Pipeline', true, NULL)
    RETURNING id INTO new_pipeline_id;

    UPDATE leads SET pipeline_id = new_pipeline_id
    WHERE org_id = org_row.id AND pipeline_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE leads ALTER COLUMN pipeline_id SET NOT NULL;

-- Pipeline-level rights: rename/delete/share metadata. A plain default-pipeline
-- member never gets these — only the creator or an org admin manages a pipeline's
-- own metadata, even the shared default one.
CREATE OR REPLACE FUNCTION can_view_pipeline(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id)
      OR p.created_by = auth.uid()
      OR (p.is_default AND is_org_member(p.org_id))
      OR EXISTS (SELECT 1 FROM pipeline_shares WHERE pipeline_id = target_pipeline AND shared_with_user_id = auth.uid())
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_edit_pipeline(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id) OR p.created_by = auth.uid()
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Lead-level rights: read/write one lead row. Inside a default pipeline this
-- reproduces today's exact created_by/assigned_to rule for every org member; inside
-- a named pipeline it's pure pipeline membership (owner, admin, or an explicit share).
CREATE OR REPLACE FUNCTION can_view_lead(target_lead UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM leads l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.id = target_lead AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_view_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_edit_lead(target_lead UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM leads l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.id = target_lead AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- INSERT has no existing row to check yet, so it's checked against the target
-- pipeline directly: a new lead in a default pipeline is createable by any org
-- member (today's behavior); in a named pipeline, only by someone who can edit it.
CREATE OR REPLACE FUNCTION can_insert_lead_into(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipelines_view" ON pipelines FOR SELECT USING (can_view_pipeline(id));
CREATE POLICY "pipelines_insert" ON pipelines FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "pipelines_update" ON pipelines FOR UPDATE USING (can_edit_pipeline(id));
CREATE POLICY "pipelines_delete" ON pipelines FOR DELETE USING (can_edit_pipeline(id) AND NOT is_default);

ALTER TABLE pipeline_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_shares_view" ON pipeline_shares FOR SELECT USING (
  shared_with_user_id = auth.uid() OR can_edit_pipeline(pipeline_id)
);
-- Only within-org shares can be inserted directly by a client. Cross-org shares are
-- only ever created by the pipeline-shares edge function (Task 11), using the
-- service role, after its own admin-to-admin authorization check.
CREATE POLICY "pipeline_shares_insert" ON pipeline_shares FOR INSERT WITH CHECK (
  can_edit_pipeline(pipeline_id)
  AND EXISTS (
    SELECT 1 FROM pipelines p
    JOIN org_members om ON om.org_id = p.org_id
    WHERE p.id = pipeline_id AND om.user_id = shared_with_user_id
  )
);
CREATE POLICY "pipeline_shares_delete" ON pipeline_shares FOR DELETE USING (
  can_edit_pipeline(pipeline_id) OR shared_with_user_id = auth.uid()
);

DROP POLICY "leads_own_in_org" ON leads;
DROP POLICY "leads_org_admin" ON leads;
CREATE POLICY "leads_view" ON leads FOR SELECT USING (can_view_lead(id));
CREATE POLICY "leads_insert" ON leads FOR INSERT WITH CHECK (can_insert_lead_into(pipeline_id));
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (can_edit_lead(id));
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (can_edit_lead(id));

DROP POLICY "notes_own_in_org" ON lead_notes;
DROP POLICY "notes_org_admin" ON lead_notes;
CREATE POLICY "notes_view" ON lead_notes FOR SELECT USING (can_view_lead(lead_id));
CREATE POLICY "notes_write" ON lead_notes FOR ALL USING (can_edit_lead(lead_id));
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP tool: `apply_migration` with `project_id: "wgomksxelyfkzepbnkdd"`,
`name: "pipelines"`, `query` = the full SQL above.

- [ ] **Step 3: Verify the backfill**

Run via the Supabase MCP `execute_sql` tool against the same project:

```sql
SELECT o.name, p.name AS pipeline_name, p.is_default,
  (SELECT COUNT(*) FROM leads WHERE pipeline_id = p.id) AS lead_count
FROM organizations o JOIN pipelines p ON p.org_id = o.id
ORDER BY o.name;
```

Expected: exactly one row per existing org, `is_default = true`, and the sum of
`lead_count` across all rows equals the total row count of `SELECT COUNT(*) FROM leads`
(every lead landed in its org's default pipeline, none left behind).

- [ ] **Step 4: Verify no leads were left without a pipeline**

```sql
SELECT COUNT(*) FROM leads WHERE pipeline_id IS NULL;
```

Expected: `0`. (This also implicitly confirms Step 1's `ALTER COLUMN ... SET NOT NULL`
succeeded — it would have failed at apply time otherwise.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/018_pipelines.sql
git commit -m "feat: add pipelines schema, RLS, and default-pipeline backfill"
```

---

### Task 2: Pipeline/PipelineShare types and Lead extension

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/leadFilters.test.ts:5-17` (the `makeLead` test factory)

**Interfaces:**
- Consumes: nothing beyond the schema from Task 1 (this task doesn't touch the DB).
- Produces: `Pipeline`, `PipelinePermission`, `PipelineShare` interfaces; `Lead` gains
  `pipeline_id: string` and `forked_from_lead_id: string | null`. Every later task
  imports these from `../types`.

- [ ] **Step 1: Add the new interfaces to `src/types/index.ts`**

Add after the closing brace of the existing `Lead` interface (currently ending at
line 58, right before `export interface LeadNote`):

```typescript
export interface Pipeline {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

export type PipelinePermission = 'view' | 'edit';

export interface PipelineShare {
  id: string;
  pipeline_id: string;
  shared_with_user_id: string;
  permission: PipelinePermission;
  shared_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Extend the `Lead` interface**

In `src/types/index.ts`, find the `Lead` interface's `raw_lead_id` field and add the
two new fields directly after it:

```typescript
  raw_lead_id: string | null;
  pipeline_id: string;
  forked_from_lead_id: string | null;
```

- [ ] **Step 3: Run the type-checker to confirm the codebase still compiles**

Run: `npx tsc --noEmit`
Expected: FAIL — `src/lib/leadFilters.test.ts`'s `makeLead` factory builds a `Lead`
literal missing the two new required fields.

- [ ] **Step 4: Fix the `makeLead` test factory**

In `src/lib/leadFilters.test.ts`, the `makeLead` function currently has this line:

```typescript
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
```

Change it to:

```typescript
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    pipeline_id: 'default-pipeline', forked_from_lead_id: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
```

- [ ] **Step 5: Run the type-checker and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing (70 existing tests still pass — this task adds no new
runtime behavior, only types).

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/leadFilters.test.ts
git commit -m "feat: add Pipeline/PipelineShare types, extend Lead with pipeline fields"
```

---

### Task 3: `usePipeline` context (current selection) and app wiring

**Files:**
- Create: `src/hooks/usePipeline.tsx`
- Modify: `src/App.tsx:1-14` (imports) and `src/App.tsx:33-37` (provider nesting)

**Interfaces:**
- Consumes: `Pipeline` type (Task 2); `useAuth()` → `{ session }`; `useOrg()` →
  `{ currentOrg }`.
- Produces: `PipelineProvider` (React component, wraps children); `usePipeline()` →
  `{ currentPipeline: Pipeline | null, pipelines: Pipeline[], loading: boolean,
  switchPipeline: (id: string) => void, refresh: () => Promise<void> }`. Every later
  task that needs "which pipeline is active" or "list every pipeline I can see" uses
  this hook.

- [ ] **Step 1: Write `src/hooks/usePipeline.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { Pipeline } from '../types';

interface PipelineContextValue {
  currentPipeline: Pipeline | null;
  pipelines: Pipeline[];
  loading: boolean;
  switchPipeline: (pipelineId: string) => void;
  refresh: () => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

/**
 * Every pipeline visible to the user — owned or default in the current org, plus
 * anything shared with them from any org (RLS returns exactly this set for a plain
 * `select('*')`, no org filter needed client-side) — and which one is active.
 */
export function PipelineProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [currentPipelineId, setCurrentPipelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session || !currentOrg) { setPipelines([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pipelines').select('*').order('is_default', { ascending: false }).order('name');
    if (error) { setLoading(false); return; }
    const rows = data as Pipeline[];
    setPipelines(rows);
    setCurrentPipelineId((current) => {
      if (current && rows.some((p) => p.id === current)) return current;
      const saved = localStorage.getItem('current-pipeline');
      const restored = rows.find((p) => p.id === saved && p.org_id === currentOrg.id);
      const fallback = rows.find((p) => p.org_id === currentOrg.id && p.is_default) ?? rows[0] ?? null;
      return (restored ?? fallback)?.id ?? null;
    });
    setLoading(false);
  }, [session, currentOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchPipeline = useCallback((pipelineId: string) => {
    localStorage.setItem('current-pipeline', pipelineId);
    setCurrentPipelineId(pipelineId);
  }, []);

  const currentPipeline = pipelines.find((p) => p.id === currentPipelineId) ?? null;

  return (
    <PipelineContext.Provider value={{ currentPipeline, pipelines, loading, switchPipeline, refresh }}>
      {children}
    </PipelineContext.Provider>
  );
}

/** Access the current pipeline context; must be used inside PipelineProvider. */
export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used inside PipelineProvider');
  return ctx;
}
```

- [ ] **Step 2: Wire `PipelineProvider` into `src/App.tsx`**

Add the import alongside the other hook-provider imports (near
`import { OrgProvider } from './hooks/useOrg';`):

```typescript
import { PipelineProvider } from './hooks/usePipeline';
```

Then nest it inside `OrgProvider` (it depends on `useOrg`, so it must sit inside),
changing:

```tsx
        <OrgProvider>
        <Routes>
```

to:

```tsx
        <OrgProvider>
        <PipelineProvider>
        <Routes>
```

and its matching closing tag, changing:

```tsx
        </Routes>
        </OrgProvider>
```

to:

```tsx
        </Routes>
        </PipelineProvider>
        </OrgProvider>
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePipeline.tsx src/App.tsx
git commit -m "feat: add usePipeline context, wire PipelineProvider into App"
```

---

### Task 4: `usePipelineActions` — create, rename, delete, within-org share, revoke

**Files:**
- Create: `src/hooks/usePipelineActions.ts`

**Interfaces:**
- Consumes: `usePipeline()` → `{ refresh }` (Task 3); `useAuth()` → `{ session }`;
  `useOrg()` → `{ currentOrg }`; `PipelinePermission` type (Task 2).
- Produces: `usePipelineActions()` → `{ createPipeline: (name: string) =>
  Promise<string | null>, renamePipeline: (pipelineId: string, name: string) =>
  Promise<string | null>, deletePipeline: (pipelineId: string) => Promise<string |
  null>, shareWithinOrg: (pipelineId: string, userId: string, permission:
  PipelinePermission) => Promise<string | null>, revokeShare: (shareId: string) =>
  Promise<string | null> }`. Task 5 adds `forkPipeline` to this same hook. Task 8
  (PipelineManage page) and Task 9 (banner) both consume this hook.

- [ ] **Step 1: Write `src/hooks/usePipelineActions.ts`**

```typescript
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { usePipeline } from './usePipeline';
import type { PipelinePermission } from '../types';

/** Create/rename/delete a pipeline you own, and manage its within-org shares. */
export function usePipelineActions() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { refresh } = usePipeline();

  const createPipeline = useCallback(async (name: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    if (!name.trim()) return 'Name is required';
    const { error } = await supabase.from('pipelines').insert({
      org_id: currentOrg.id, name: name.trim(), created_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const renamePipeline = useCallback(async (pipelineId: string, name: string): Promise<string | null> => {
    if (!name.trim()) return 'Name is required';
    const { error } = await supabase.from('pipelines').update({ name: name.trim() }).eq('id', pipelineId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  /** Refuses to delete a non-empty pipeline — move or delete its leads first. */
  const deletePipeline = useCallback(async (pipelineId: string): Promise<string | null> => {
    const { count, error: countErr } = await supabase
      .from('leads').select('id', { count: 'exact', head: true }).eq('pipeline_id', pipelineId);
    if (countErr) return countErr.message;
    if ((count ?? 0) > 0) return 'Move or delete every lead in this pipeline before deleting it.';
    const { error } = await supabase.from('pipelines').delete().eq('id', pipelineId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  /** Within-org only — RLS rejects a target user outside the pipeline's own org. */
  const shareWithinOrg = useCallback(
    async (pipelineId: string, userId: string, permission: PipelinePermission): Promise<string | null> => {
      const { error } = await supabase.from('pipeline_shares').insert({
        pipeline_id: pipelineId, shared_with_user_id: userId, permission, shared_by: session?.user.id,
      });
      return error ? error.message : null;
    },
    [session],
  );

  const revokeShare = useCallback(async (shareId: string): Promise<string | null> => {
    const { error } = await supabase.from('pipeline_shares').delete().eq('id', shareId);
    return error ? error.message : null;
  }, []);

  return { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare };
}
```

- [ ] **Step 2: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePipelineActions.ts
git commit -m "feat: add usePipelineActions (create/rename/delete/share/revoke)"
```

---

### Task 5: Fork logic — pure helper, tests, and `forkPipeline` action

**Files:**
- Create: `src/lib/pipelineFork.ts`
- Create: `src/lib/pipelineFork.test.ts`
- Modify: `src/hooks/usePipelineActions.ts` (add `forkPipeline`)

**Interfaces:**
- Consumes: `Lead`, `Pipeline` types (Task 2); the `usePipelineActions` hook shape
  from Task 4 (this task extends it).
- Produces: `buildForkedLeadRows(sourceLeads: Lead[], newPipelineId: string,
  newOrgId: string, forkerId: string): ForkedLeadRow[]` (pure, exported from
  `src/lib/pipelineFork.ts`); `usePipelineActions()` gains `forkPipeline: (source:
  Pipeline) => Promise<{ error: string | null; pipeline: Pipeline | null }>`. Task 9
  (banner) and Task 8 (PipelineManage page) both call `forkPipeline`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pipelineFork.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildForkedLeadRows } from './pipelineFork';
import type { Lead } from '../types';

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null, is_priority: false,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    pipeline_id: 'source-pipeline', forked_from_lead_id: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildForkedLeadRows', () => {
  it('copies working fields into the new pipeline/org, owned by the forker', () => {
    const source = makeLead({
      business_name: 'Shiny Cleaners', stage: 'contacted', deal_value: 500,
      assigned_to: 'u1', call_count: 3, last_contacted_at: '2026-07-05T00:00:00Z', raw_lead_id: 'raw-1',
    });
    const [row] = buildForkedLeadRows([source], 'new-pipe', 'new-org', 'forker-id');
    expect(row.business_name).toBe('Shiny Cleaners');
    expect(row.stage).toBe('contacted');
    expect(row.deal_value).toBe(500);
    expect(row.org_id).toBe('new-org');
    expect(row.pipeline_id).toBe('new-pipe');
    expect(row.created_by).toBe('forker-id');
    expect(row.forked_from_lead_id).toBe(source.id);
  });

  it('does not carry over assigned_to, call history, or the source raw_lead_id link', () => {
    const source = makeLead({
      assigned_to: 'u1', call_count: 3, last_contacted_at: '2026-07-05T00:00:00Z', raw_lead_id: 'raw-1',
    });
    const [row] = buildForkedLeadRows([source], 'new-pipe', 'new-org', 'forker-id');
    expect(row).not.toHaveProperty('assigned_to');
    expect(row).not.toHaveProperty('call_count');
    expect(row).not.toHaveProperty('last_contacted_at');
    expect(row).not.toHaveProperty('raw_lead_id');
  });

  it('returns an empty array for an empty source pipeline', () => {
    expect(buildForkedLeadRows([], 'new-pipe', 'new-org', 'forker-id')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/pipelineFork.test.ts`
Expected: FAIL with "Failed to resolve import" / "buildForkedLeadRows is not a function"
(the module doesn't exist yet).

- [ ] **Step 3: Write `src/lib/pipelineFork.ts`**

```typescript
import type { Lead } from '../types';

export interface ForkedLeadRow {
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  google_rating: number | null;
  review_count: number | null;
  vertical: string | null;
  stage: Lead['stage'];
  package_tier: Lead['package_tier'];
  deal_value: number | null;
  next_action_date: string | null;
  next_action_note: string | null;
  is_priority: boolean;
  kanban_position: number;
  org_id: string;
  pipeline_id: string;
  created_by: string;
  forked_from_lead_id: string;
}

/**
 * Builds insert rows for a pipeline fork: copies each source lead's working data
 * into the new pipeline/org. Deliberately resets assigned_to, call_count,
 * last_contacted_at, and raw_lead_id — those describe the SOURCE side's own work
 * history and scraper provenance, not something that should carry into an
 * independent copy — and records forked_from_lead_id for pure traceability (never a
 * live link; nothing here or later syncs back to the source).
 */
export function buildForkedLeadRows(
  sourceLeads: Lead[],
  newPipelineId: string,
  newOrgId: string,
  forkerId: string,
): ForkedLeadRow[] {
  return sourceLeads.map((lead) => ({
    business_name: lead.business_name,
    owner_name: lead.owner_name,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    address: lead.address,
    city: lead.city,
    postcode: lead.postcode,
    google_rating: lead.google_rating,
    review_count: lead.review_count,
    vertical: lead.vertical,
    stage: lead.stage,
    package_tier: lead.package_tier,
    deal_value: lead.deal_value,
    next_action_date: lead.next_action_date,
    next_action_note: lead.next_action_note,
    is_priority: lead.is_priority,
    kanban_position: lead.kanban_position,
    org_id: newOrgId,
    pipeline_id: newPipelineId,
    created_by: forkerId,
    forked_from_lead_id: lead.id,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/pipelineFork.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `forkPipeline` to `usePipelineActions`**

In `src/hooks/usePipelineActions.ts`, add the import:

```typescript
import { buildForkedLeadRows } from '../lib/pipelineFork';
import type { Lead, Pipeline, PipelinePermission } from '../types';
```

(replacing the existing `import type { PipelinePermission } from '../types';` line).

Then add this function inside the hook, after `revokeShare` and before the `return`:

```typescript
  /**
   * Snapshots every lead currently in `source` into a brand-new pipeline owned by
   * the current org — independent from that moment on, per the design spec. Returns
   * the new pipeline so the caller can switch the active pipeline to it.
   */
  const forkPipeline = useCallback(async (source: Pipeline): Promise<{ error: string | null; pipeline: Pipeline | null }> => {
    if (!currentOrg || !session) return { error: 'No organization selected', pipeline: null };
    const { data: sourceLeads, error: leadsErr } = await supabase
      .from('leads').select('*').eq('pipeline_id', source.id);
    if (leadsErr) return { error: leadsErr.message, pipeline: null };
    const { data: newPipeline, error: pipelineErr } = await supabase
      .from('pipelines')
      .insert({ org_id: currentOrg.id, name: `${source.name} (copy)`, created_by: session.user.id })
      .select('*').single();
    if (pipelineErr) return { error: pipelineErr.message, pipeline: null };
    const rows = buildForkedLeadRows(sourceLeads as Lead[], newPipeline.id, currentOrg.id, session.user.id);
    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('leads').insert(rows);
      if (insertErr) return { error: insertErr.message, pipeline: null };
    }
    await refresh();
    return { error: null, pipeline: newPipeline as Pipeline };
  }, [currentOrg, session, refresh]);
```

Update the hook's `return` statement to include it:

```typescript
  return { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare, forkPipeline };
```

- [ ] **Step 6: Run the type-checker and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing (73 tests: 70 existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/lib/pipelineFork.ts src/lib/pipelineFork.test.ts src/hooks/usePipelineActions.ts
git commit -m "feat: add pipeline forking (buildForkedLeadRows + forkPipeline action)"
```

---

### Task 6: `PipelineSwitcher` component and top-bar wiring

**Files:**
- Create: `src/components/layout/PipelineSwitcher.tsx`
- Modify: `src/components/layout/TopBar.tsx`

**Interfaces:**
- Consumes: `useOrg()` → `{ currentOrg, orgs }`; `usePipeline()` → `{
  currentPipeline, pipelines, switchPipeline }` (Task 3).
- Produces: `PipelineSwitcher` component, rendered in the top bar next to
  `OrgSwitcher`.

- [ ] **Step 1: Write `src/components/layout/PipelineSwitcher.tsx`**

```tsx
import { GitBranch } from 'lucide-react';
import { Link } from 'react-router';
import { useOrg } from '../../hooks/useOrg';
import { usePipeline } from '../../hooks/usePipeline';

/** Pipeline switcher — renders nothing while only the org's default pipeline exists. */
export function PipelineSwitcher() {
  const { currentOrg, orgs } = useOrg();
  const { currentPipeline, pipelines, switchPipeline } = usePipeline();
  if (pipelines.length <= 1) return null;

  const owned = pipelines.filter((p) => p.org_id === currentOrg?.id);
  const shared = pipelines.filter((p) => p.org_id !== currentOrg?.id);

  function orgNameFor(orgId: string): string {
    return orgs.find((o) => o.id === orgId)?.name ?? 'Shared pipeline';
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <GitBranch className="h-4 w-4 text-muted" aria-hidden />
      <select
        aria-label="Current pipeline"
        value={currentPipeline?.id ?? ''}
        onChange={(e) => switchPipeline(e.target.value)}
        className="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-2 text-sm font-semibold"
      >
        <optgroup label="Your org">
          {owned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
        {shared.length > 0 && (
          <optgroup label="Shared with you">
            {shared.map((p) => <option key={p.id} value={p.id}>{p.name} — {orgNameFor(p.org_id)}</option>)}
          </optgroup>
        )}
      </select>
      <Link to="/pipeline/manage" className="text-xs font-semibold text-cyan hover:underline">Manage</Link>
    </label>
  );
}
```

- [ ] **Step 2: Wire it into `src/components/layout/TopBar.tsx`**

Add the import:

```typescript
import { PipelineSwitcher } from './PipelineSwitcher';
```

Add `<PipelineSwitcher />` immediately before `<OrgSwitcher />`:

```tsx
      <ThemeToggle />
      <PipelineSwitcher />
      <OrgSwitcher />
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PipelineSwitcher.tsx src/components/layout/TopBar.tsx
git commit -m "feat: add pipeline switcher to the top bar"
```

---

### Task 7: Scope `useLeads` by the active pipeline

**Files:**
- Modify: `src/hooks/useLeads.ts` (full file)

**Interfaces:**
- Consumes: `usePipeline()` → `{ currentPipeline }` (Task 3).
- Produces: `useLeads()`'s existing return shape is unchanged (`{ leads, loading,
  error, refresh, createLead, updateLead }`) — only its internal scoping changes.
  Every page currently calling `useLeads()` (`PipelineKanban.tsx`, `PipelineList.tsx`,
  `AssignmentPanel.tsx` via a direct query, `Dashboard.tsx`) keeps working with zero
  call-site changes for reads; `createLead`'s callers are unaffected too.

- [ ] **Step 1: Replace the full contents of `src/hooks/useLeads.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { usePipeline } from './usePipeline';
import type { Lead, PackageTier, Stage } from '../types';

export interface LeadInput {
  business_name: string;
  owner_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  vertical?: string | null;
  stage?: Stage;
  package_tier?: PackageTier | null;
  deal_value?: number | null;
  assigned_to?: string | null;
  next_action_date?: string | null;
  next_action_note?: string | null;
}

/** Leads in the currently active pipeline, kept fresh via a realtime subscription. */
export function useLeads() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { currentPipeline } = usePipeline();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg || !currentPipeline) { setLeads([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('leads').select('*').eq('pipeline_id', currentPipeline.id).order('kanban_position').order('created_at');
    if (err) setError(err.message);
    else { setLeads(data as Lead[]); setError(null); }
    setLoading(false);
  }, [currentOrg, currentPipeline]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Inserts a lead in the active pipeline; returns error message or null. Uses the
   * pipeline's own org_id, not the org switcher's currently-selected one — the two
   * can transiently disagree, and a wrong-tenant org_id write is a real bug class
   * this project has hit before. */
  const createLead = useCallback(
    async (input: LeadInput): Promise<string | null> => {
      if (!currentPipeline) return 'No pipeline selected';
      const stage = input.stage ?? 'new_lead';
      const maxPos = Math.max(0, ...leads.filter((l) => l.stage === stage).map((l) => l.kanban_position));
      const { error: err } = await supabase.from('leads').insert({
        ...input,
        stage,
        kanban_position: maxPos + 1,
        created_by: session?.user.id,
        org_id: currentPipeline.org_id,
        pipeline_id: currentPipeline.id,
      });
      if (err) return err.message;
      await refresh();
      return null;
    },
    [leads, session, currentPipeline, refresh],
  );

  /** Patches a lead (stage changes auto-logged); optimistic local update, then refresh. */
  const updateLead = useCallback(
    async (id: string, patch: LeadPatch): Promise<string | null> => {
      const before = leads.find((l) => l.id === id) ?? null;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      const err = await applyLeadUpdate(id, patch, before, session?.user.id);
      if (err) await refresh(); // roll back the optimistic update
      return err;
    },
    [leads, session, refresh],
  );

  return { leads, loading, error, refresh, createLead, updateLead };
}
```

- [ ] **Step 2: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLeads.ts
git commit -m "feat: scope useLeads by the active pipeline, not just org"
```

---

### Task 8: `/pipeline/manage` page

**Files:**
- Create: `src/hooks/usePipelineShares.ts`
- Create: `src/pages/PipelineManage.tsx`
- Modify: `src/App.tsx` (add the route)

**Interfaces:**
- Consumes: `usePipeline()` (Task 3), `usePipelineActions()` (Tasks 4-5),
  `useProfiles()` (existing — org member list for the within-org share picker),
  `useOrg()`, `useAuth()`.
- Produces: `usePipelineShares(ownedPipelineIds: string[])` → `{ outgoing:
  Record<string, OutgoingShare[]>, incoming: IncomingShare[], loading: boolean,
  refresh: () => Promise<void> }`; route `/pipeline/manage`.

- [ ] **Step 1: Write `src/hooks/usePipelineShares.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Pipeline, PipelinePermission } from '../types';

export interface OutgoingShare {
  id: string;
  pipeline_id: string;
  permission: PipelinePermission;
  profiles: { id: string; full_name: string | null; email: string };
}

export interface IncomingShare {
  id: string;
  permission: PipelinePermission;
  pipelines: Pipeline;
}

/** Shares on pipelines the user owns (outgoing, grouped by pipeline) and shares
 * granted to the user (incoming, any org). */
export function usePipelineShares(ownedPipelineIds: string[]) {
  const { session } = useAuth();
  const [outgoing, setOutgoing] = useState<Record<string, OutgoingShare[]>>({});
  const [incoming, setIncoming] = useState<IncomingShare[]>([]);
  const [loading, setLoading] = useState(true);
  const idsKey = ownedPipelineIds.join(',');

  const refresh = useCallback(async () => {
    if (!session) { setOutgoing({}); setIncoming([]); setLoading(false); return; }
    const ids = idsKey ? idsKey.split(',') : [];
    const [outRes, inRes] = await Promise.all([
      ids.length > 0
        ? supabase
            .from('pipeline_shares')
            .select('id, pipeline_id, permission, profiles!pipeline_shares_shared_with_user_id_fkey(id, full_name, email)')
            .in('pipeline_id', ids)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      supabase.from('pipeline_shares').select('id, permission, pipelines(*)').eq('shared_with_user_id', session.user.id),
    ]);
    if (!outRes.error) {
      const grouped: Record<string, OutgoingShare[]> = {};
      for (const row of (outRes.data as unknown as OutgoingShare[]) ?? []) {
        (grouped[row.pipeline_id] ??= []).push(row);
      }
      setOutgoing(grouped);
    }
    if (!inRes.error) setIncoming((inRes.data as unknown as IncomingShare[]) ?? []);
    setLoading(false);
  }, [session, idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { outgoing, incoming, loading, refresh };
}
```

- [ ] **Step 2: Write `src/pages/PipelineManage.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Plus, Share2, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineActions } from '../hooks/usePipelineActions';
import { usePipelineShares } from '../hooks/usePipelineShares';
import { useProfiles } from '../hooks/useProfiles';
import { useOrg } from '../hooks/useOrg';
import { Button } from '../components/ui/Button';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import type { Pipeline, PipelinePermission } from '../types';

/** Create/rename/delete pipelines you can manage (your own, or any in your org if
 * you're an org admin — mirroring can_edit_pipeline's server-side rule), manage
 * their shares, and act on shares granted to you (view, or fork into your own copy). */
export function PipelineManage() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { pipelines, loading: pipelinesLoading, switchPipeline } = usePipeline();
  const { profiles } = useProfiles();
  const { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare, forkPipeline } = usePipelineActions();
  const navigate = useNavigate();

  // Mirrors the server-side can_edit_pipeline rule (org admin OR creator OR
  // default) — a UI convenience only, RLS is still the real gate on every action.
  const canManage = currentOrg?.role === 'admin'
    ? (p: Pipeline) => p.org_id === currentOrg.id
    : (p: Pipeline) => p.org_id === currentOrg?.id && (p.is_default || p.created_by === session?.user.id);
  const owned = pipelines.filter(canManage);
  const ownedIds = owned.map((p) => p.id);
  const { outgoing, incoming, loading: sharesLoading, refresh: refreshShares } = usePipelineShares(ownedIds);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<Record<string, string>>({});
  const [sharePermission, setSharePermission] = useState<Record<string, PipelinePermission>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const err = await createPipeline(newName);
    if (err) setError(err);
    else setNewName('');
  }

  async function handleRename(pipeline: Pipeline) {
    const name = window.prompt('Rename pipeline', pipeline.name);
    if (!name) return;
    const err = await renamePipeline(pipeline.id, name);
    if (err) setError(err);
  }

  async function handleDelete(pipeline: Pipeline) {
    setBusyId(pipeline.id);
    const err = await deletePipeline(pipeline.id);
    setBusyId(null);
    if (err) setError(err);
  }

  async function handleShare(pipeline: Pipeline) {
    const userId = shareTarget[pipeline.id];
    const permission = sharePermission[pipeline.id] ?? 'view';
    if (!userId) return;
    const err = await shareWithinOrg(pipeline.id, userId, permission);
    if (err) setError(err);
    else await refreshShares();
  }

  async function handleRevoke(shareId: string) {
    const err = await revokeShare(shareId);
    if (err) setError(err);
    else await refreshShares();
  }

  async function handleFork(pipeline: Pipeline) {
    setBusyId(pipeline.id);
    const { error: err, pipeline: forked } = await forkPipeline(pipeline);
    setBusyId(null);
    if (err) { setError(err); return; }
    if (forked) { switchPipeline(forked.id); navigate('/pipeline/kanban'); }
  }

  if (pipelinesLoading || sharesLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-[28px] font-extrabold">Manage pipelines</h1>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Your pipelines</h2>
        <div className="flex items-end gap-3">
          <Input label="New pipeline name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={() => void handleCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            Create
          </Button>
        </div>
        <ul className="flex flex-col gap-3">
          {owned.map((pipeline) => (
            <li key={pipeline.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">
                  {pipeline.name}
                  {pipeline.is_default && <span className="ml-2 text-xs text-muted">(default — can't be deleted)</span>}
                </span>
                {!pipeline.is_default && (
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => void handleRename(pipeline)}>Rename</Button>
                    <Button variant="danger" onClick={() => void handleDelete(pipeline)} disabled={busyId === pipeline.id}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <ul className="mt-3 flex flex-col gap-1">
                {(outgoing[pipeline.id] ?? []).map((share) => (
                  <li key={share.id} className="flex items-center justify-between text-sm text-muted">
                    <span>{share.profiles.full_name ?? share.profiles.email} — {share.permission}</span>
                    <button type="button" onClick={() => void handleRevoke(share.id)} aria-label="Revoke access" className="cursor-pointer hover:text-danger">
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-end gap-2">
                <SelectField
                  label="Share with"
                  value={shareTarget[pipeline.id] ?? ''}
                  onChange={(e) => setShareTarget((prev) => ({ ...prev, [pipeline.id]: e.target.value }))}
                >
                  <option value="">Choose teammate…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                  ))}
                </SelectField>
                <SelectField
                  label="Permission"
                  value={sharePermission[pipeline.id] ?? 'view'}
                  onChange={(e) => setSharePermission((prev) => ({ ...prev, [pipeline.id]: e.target.value as PipelinePermission }))}
                >
                  <option value="view">View</option>
                  <option value="edit">Edit (can fork)</option>
                </SelectField>
                <Button variant="secondary" onClick={() => void handleShare(pipeline)}>
                  <Share2 className="h-4 w-4" aria-hidden />
                  Share
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Shared with you</h2>
        {incoming.length === 0 && <p className="text-sm text-muted">Nothing shared with you yet.</p>}
        <ul className="flex flex-col gap-3">
          {incoming.map((share) => (
            <li key={share.id} className="flex items-center justify-between rounded-xl border border-line bg-card p-4">
              <span className="font-semibold">{share.pipelines.name} — {share.permission}</span>
              {share.permission === 'edit' && (
                <Button onClick={() => void handleFork(share.pipelines)} disabled={busyId === share.pipelines.id}>
                  <Copy className="h-4 w-4" aria-hidden />
                  Make my own copy
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add the route in `src/App.tsx`**

Add the import alongside the other page imports:

```typescript
import { PipelineManage } from './pages/PipelineManage';
```

Add the route right after the existing `/pipeline/leads/:id` route:

```tsx
              <Route path="/pipeline/leads/:id" element={<LeadDetailPage />} />
              <Route path="/pipeline/manage" element={<PipelineManage />} />
```

- [ ] **Step 4: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePipelineShares.ts src/pages/PipelineManage.tsx src/App.tsx
git commit -m "feat: add /pipeline/manage page for pipeline CRUD and sharing"
```

---

### Task 9: Shared-pipeline banner on Kanban/List

**Files:**
- Create: `src/hooks/usePipelinePermission.ts`
- Create: `src/components/pipeline/SharedPipelineBanner.tsx`
- Modify: `src/pages/PipelineKanban.tsx`
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Consumes: `usePipeline()` (Task 3), `usePipelineActions().forkPipeline` (Task 5),
  `useAuth()`.
- Produces: `usePipelinePermission(pipelineId: string | null) => PipelinePermission |
  null`; `SharedPipelineBanner` component, rendered on both pipeline pages.

- [ ] **Step 1: Write `src/hooks/usePipelinePermission.ts`**

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { PipelinePermission } from '../types';

/** The current user's own share permission on a pipeline, or null if they own it,
 * it's a default pipeline, or they have no explicit share at all. */
export function usePipelinePermission(pipelineId: string | null): PipelinePermission | null {
  const { session } = useAuth();
  const [permission, setPermission] = useState<PipelinePermission | null>(null);

  useEffect(() => {
    if (!pipelineId || !session) { setPermission(null); return; }
    let cancelled = false;
    void supabase
      .from('pipeline_shares').select('permission')
      .eq('pipeline_id', pipelineId).eq('shared_with_user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPermission((data?.permission as PipelinePermission | undefined) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId, session]);

  return permission;
}
```

- [ ] **Step 2: Write `src/components/pipeline/SharedPipelineBanner.tsx`**

```tsx
import { Copy, Eye } from 'lucide-react';
import { usePipeline } from '../../hooks/usePipeline';
import { usePipelineActions } from '../../hooks/usePipelineActions';
import { usePipelinePermission } from '../../hooks/usePipelinePermission';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/Button';

/**
 * Persistent banner shown whenever the active pipeline isn't owned by the current
 * user — a prominent "Make my own copy" CTA for edit-shared pipelines, a plain
 * read-only notice for view-shared ones. Renders nothing for an owned or default
 * pipeline (usePipelinePermission returns null in both cases).
 */
export function SharedPipelineBanner() {
  const { currentPipeline, switchPipeline } = usePipeline();
  const { session } = useAuth();
  const { forkPipeline } = usePipelineActions();
  const isOwnedOrDefault = !currentPipeline || currentPipeline.created_by === session?.user.id || currentPipeline.is_default;
  const permission = usePipelinePermission(isOwnedOrDefault ? null : currentPipeline!.id);
  if (!permission || !currentPipeline) return null;

  async function handleFork() {
    if (!currentPipeline) return;
    const { pipeline: forked } = await forkPipeline(currentPipeline);
    if (forked) switchPipeline(forked.id);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-cyan/40 bg-cyan/10 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Eye className="h-4 w-4 text-cyan" aria-hidden />
        {permission === 'edit'
          ? "You're viewing a pipeline shared with you. Fork it to work your own copy."
          : "You're viewing a shared pipeline (read-only)."}
      </div>
      {permission === 'edit' && (
        <Button onClick={() => void handleFork()}>
          <Copy className="h-4 w-4" aria-hidden />
          Make my own copy
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it on `src/pages/PipelineKanban.tsx`**

Add the import, alongside the other component imports:

```typescript
import { SharedPipelineBanner } from '../components/pipeline/SharedPipelineBanner';
```

In the returned JSX, change:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
```

to:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <SharedPipelineBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
```

- [ ] **Step 4: Render it on `src/pages/PipelineList.tsx`**

Add the same import, alongside the other component imports:

```typescript
import { SharedPipelineBanner } from '../components/pipeline/SharedPipelineBanner';
```

In the returned JSX, change:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
```

to:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <SharedPipelineBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
```

- [ ] **Step 5: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePipelinePermission.ts src/components/pipeline/SharedPipelineBanner.tsx src/pages/PipelineKanban.tsx src/pages/PipelineList.tsx
git commit -m "feat: add shared-pipeline banner with fork CTA to Kanban/List"
```

---

### Task 10: Scraper approval gains a pipeline-select step

**Files:**
- Modify: `src/hooks/useRawLeadActions.ts` (full file)
- Modify: `src/pages/ScraperJob.tsx`

**Interfaces:**
- Consumes: `usePipeline()` → `{ currentPipeline, pipelines }` (Task 3).
- Produces: `useRawLeadActions(jobOrgId, pipelineId)` — `approve` now requires a
  `pipelineId` argument; the hook's other actions (`reject`, `skip`, `enrichWithApollo`,
  `enrichWithHunter`) are unchanged.

- [ ] **Step 1: Replace the full contents of `src/hooks/useRawLeadActions.ts`**

```typescript
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { RawLead } from '../types';

/** Approve/reject/skip a raw_leads row, plus the two paid enrichment actions. */
export function useRawLeadActions(jobOrgId?: string, pipelineId?: string) {
  const { session } = useAuth();

  const approve = useCallback(async (lead: RawLead): Promise<string | null> => {
    if (!jobOrgId) return 'Could not determine the organization for this lead';
    if (!pipelineId) return 'Choose a pipeline before approving';
    const { error: insertErr } = await supabase.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address, city: lead.city,
      postcode: lead.postcode, google_rating: lead.google_rating, review_count: lead.review_count,
      vertical: lead.vertical, stage: 'new_lead', org_id: jobOrgId, pipeline_id: pipelineId,
      created_by: session?.user.id, raw_lead_id: lead.id,
    });
    if (insertErr) return insertErr.message;
    const { error: updateErr } = await supabase.from('raw_leads').update({
      status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString(),
    }).eq('id', lead.id);
    return updateErr ? updateErr.message : null;
  }, [jobOrgId, pipelineId, session]);

  const reject = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { error } = await supabase.from('raw_leads').update({ status: 'rejected' }).eq('id', lead.id);
    return error ? error.message : null;
  }, []);

  const skip = useCallback(async (): Promise<string | null> => {
    return null; // "Skip" is a no-op — the row simply stays status='pending' for a later session.
  }, []);

  const enrichWithApollo = useCallback(async (lead: RawLead): Promise<string | null> => {
    // No org_id sent — enrich-apollo derives it authoritatively from the lead
    // itself server-side (see Task 7), so there's nothing here to spoof.
    const { data, error } = await supabase.functions.invoke('enrich-apollo', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  const enrichWithHunter = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('enrich-hunter', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  return { approve, reject, skip, enrichWithApollo, enrichWithHunter };
}
```

- [ ] **Step 2: Add the pipeline-select control to `src/pages/ScraperJob.tsx`**

Add the import:

```typescript
import { usePipeline } from '../hooks/usePipeline';
```

Change the hook calls near the top of the `ScraperJob` component from:

```tsx
  const { job, rawLeads, loading, refresh } = useScrapeJob(id!);
  const { approve, reject, skip, enrichWithApollo, enrichWithHunter } = useRawLeadActions(job?.org_id);
```

to:

```tsx
  const { job, rawLeads, loading, refresh } = useScrapeJob(id!);
  const { pipelines, currentPipeline } = usePipeline();
  const [pipelineId, setPipelineId] = useState(currentPipeline?.id ?? '');
  const { approve, reject, skip, enrichWithApollo, enrichWithHunter } = useRawLeadActions(job?.org_id, pipelineId);
```

Add `SelectField` to the existing import from `'../components/ui/Input'` — there
isn't one yet in this file, so add:

```typescript
import { SelectField } from '../components/ui/Input';
```

In the JSX, add a pipeline picker to the header row — change:

```tsx
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Scrape results</h1>
          {statusBadge(job)}
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
      </header>
```

to:

```tsx
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Scrape results</h1>
          {statusBadge(job)}
        </div>
        <div className="flex items-center gap-3">
          <SelectField label="Approve into" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Choose pipeline…</option>
            {pipelines.filter((p) => p.org_id === job.org_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectField>
          <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
        </div>
      </header>
```

Finally, disable the approve button while no pipeline is chosen — change:

```tsx
                    <Button variant="secondary" onClick={() => void runAction(lead, approve)} disabled={busyId === lead.id} title="Approve">
```

to:

```tsx
                    <Button variant="secondary" onClick={() => void runAction(lead, approve)} disabled={busyId === lead.id || !pipelineId} title="Approve">
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRawLeadActions.ts src/pages/ScraperJob.tsx
git commit -m "feat: require a pipeline choice when approving scraped leads"
```

---

### Task 11: Cross-org sharing edge function

**Files:**
- Create: `supabase/functions/pipeline-shares/index.ts`
- Modify: `src/pages/PipelineManage.tsx`

**Interfaces:**
- Consumes: the four RLS helper functions from Task 1 are NOT used directly here —
  this function uses the service role and does its own authorization checks, mirroring
  `admin-users/index.ts`'s pattern exactly.
- Produces: a deployed edge function `pipeline-shares` accepting `{ action:
  'share_cross_org', pipeline_id: string, email: string, permission:
  PipelinePermission }`, returning `{ ok: true }` or `{ error: string }`. `PipelineManage.tsx`
  gains a "Share with an admin in another org" control that calls it.

- [ ] **Step 1: Write `supabase/functions/pipeline-shares/index.ts`**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173').split(',');

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = (await req.json()) as Record<string, unknown>;
  if (body.action !== 'share_cross_org') return json({ error: 'Unknown action' }, 400, headers);

  const pipelineId = String(body.pipeline_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const permission = String(body.permission ?? '');
  if (!pipelineId) return json({ error: 'pipeline_id is required' }, 400, headers);
  if (!email) return json({ error: 'email is required' }, 400, headers);
  if (permission !== 'view' && permission !== 'edit') return json({ error: 'Invalid permission' }, 400, headers);

  const { data: pipeline } = await service.from('pipelines').select('id, org_id, created_by').eq('id', pipelineId).maybeSingle();
  if (!pipeline) return json({ error: 'Pipeline not found' }, 404, headers);

  const { data: callerMembership } = await service
    .from('org_members').select('role').eq('org_id', pipeline.org_id).eq('user_id', caller.id).maybeSingle();
  const callerIsAdmin = callerMembership?.role === 'admin';
  if (!callerIsAdmin && pipeline.created_by !== caller.id) {
    return json({ error: 'Only an org admin (or the pipeline owner) can share it outside the org' }, 403, headers);
  }
  if (!callerIsAdmin) {
    return json({ error: 'Cross-org sharing requires an org admin' }, 403, headers);
  }

  const { data: targetProfile } = await service.from('profiles').select('id').eq('email', email).maybeSingle();
  // Deliberately generic — never confirms whether a non-admin email exists at all.
  const notFoundError = { error: 'No matching admin found for that email' };
  if (!targetProfile) return json(notFoundError, 404, headers);

  const { data: targetIsAdminAnywhere } = await service
    .from('org_members').select('org_id').eq('user_id', targetProfile.id).eq('role', 'admin').limit(1);
  if (!targetIsAdminAnywhere || targetIsAdminAnywhere.length === 0) return json(notFoundError, 404, headers);

  const { error: shareErr } = await service.from('pipeline_shares').insert({
    pipeline_id: pipelineId, shared_with_user_id: targetProfile.id, permission, shared_by: caller.id,
  });
  if (shareErr) return json({ error: shareErr.message }, 400, headers);
  return json({ ok: true }, 200, headers);
});
```

- [ ] **Step 2: Deploy the edge function**

Use the Supabase MCP tool: `deploy_edge_function` with `project_id:
"wgomksxelyfkzepbnkdd"`, `name: "pipeline-shares"`, `entrypoint_path: "index.ts"`, and
`files` containing the file above.

- [ ] **Step 3: Add the cross-org share control to `src/pages/PipelineManage.tsx`**

Add a `useState` for the cross-org email input, alongside the existing `shareTarget`/
`sharePermission` state:

```typescript
  const [crossOrgEmail, setCrossOrgEmail] = useState<Record<string, string>>({});
```

Add this function alongside the existing `handleShare`:

```typescript
  async function handleShareCrossOrg(pipeline: Pipeline) {
    const email = crossOrgEmail[pipeline.id];
    const permission = sharePermission[pipeline.id] ?? 'view';
    if (!email) return;
    const { data, error: invokeErr } = await supabase.functions.invoke('pipeline-shares', {
      body: { action: 'share_cross_org', pipeline_id: pipeline.id, email, permission },
    });
    if (invokeErr) { setError(invokeErr.message); return; }
    const result = data as { error?: string };
    if (result.error) { setError(result.error); return; }
    setCrossOrgEmail((prev) => ({ ...prev, [pipeline.id]: '' }));
    await refreshShares();
  }
```

Add the `supabase` import at the top of the file (it isn't imported yet in this
file):

```typescript
import { supabase } from '../lib/supabase';
```

In the JSX, add the cross-org control directly after the existing within-org share
row (`<div className="mt-3 flex items-end gap-2">...</div>` block):

```tsx
              <div className="mt-2 flex items-end gap-2">
                <Input
                  label="Or share with an admin in another org (by email)"
                  type="email"
                  value={crossOrgEmail[pipeline.id] ?? ''}
                  onChange={(e) => setCrossOrgEmail((prev) => ({ ...prev, [pipeline.id]: e.target.value }))}
                />
                <Button variant="secondary" onClick={() => void handleShareCrossOrg(pipeline)}>
                  <Share2 className="h-4 w-4" aria-hidden />
                  Share
                </Button>
              </div>
```

- [ ] **Step 4: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean/passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pipeline-shares/index.ts src/pages/PipelineManage.tsx
git commit -m "feat: add cross-org pipeline sharing (admin-to-admin) edge function"
```
