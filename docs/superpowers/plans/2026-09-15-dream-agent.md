# Dream Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Dream Agent — a new page where free-form session notes (typed or
voice) get parsed by AI into confirm-before-apply updates across every lead they
touch, plus a CSV-upload path that reuses the existing scraper review pipeline — and
extend the Scraper and Pipeline Manage pages with the same "which pipeline?" choice.

**Architecture:** Two new edge functions extend this app's existing Gemini-backed AI
layer: `parse-session-notes` (multi-lead note parsing, stateless — resends the whole
conversation each round) and `parse-csv-leads` (column-mapping only; per-row
extraction and duplicate detection stay deterministic, not AI-driven, feeding the
existing `scrape_jobs`/`raw_leads` tables so CSV imports land on the exact review page
a real scrape already uses). A new client-side action-list resolution model
(`update`/`create`/`ambiguous`) mirrors the existing `SuggestionDiff` guardrail
pattern, extended to a list, with a "reply in free text to refine" loop on top that
never bypasses the per-row confirm step.

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres + RLS + Deno edge
functions + Gemini via `_shared/ai.ts`), Vitest, browser `SpeechRecognition` API,
Tailwind v4 (existing design tokens only).

**Spec:** `docs/superpowers/specs/2026-09-15-dream-agent-design.md`

## Global Constraints

- Nothing is ever written to the database without an explicit confirm — no
  auto-apply, at any point in the notes flow's refinement loop or the CSV flow's
  batch confirm.
- "Whole platform" matching in the notes flow is scoped to the caller's
  currently-selected org only — never spans a pipeline shared in from a different
  org, even one the caller can fully edit/fork.
- CSV duplicate detection checks every lead in the target pipeline's whole org, not
  just the target pipeline, matching the scraper's own existing precedent.
- CSV imports reuse `scrape_jobs`/`raw_leads` and the existing `ScraperJob` review
  page — no parallel review UI.
- Autopilot's own pipeline choice is explicitly out of scope for this plan.
- TypeScript strict mode, named exports only, Tailwind utility classes only
  (existing design tokens — no new colors).
- Voice input uses the browser's `SpeechRecognition` API only — no audio upload, no
  paid transcription service.

---

### Task 1: `parseCsv` — CSV parsing utility

**Files:**
- Modify: `src/lib/csv.ts`
- Test: `src/lib/csv.test.ts` (new)

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]` — RFC-4180-symmetric with the
  existing `toCsv`. First returned row is the header row; every row is padded/kept as
  raw string cells (no type coercion). Consumed by Task 10 (Dream Agent CSV tab).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/csv.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple CSV with a header row', () => {
    expect(parseCsv('Name,City\nAcme Ltd,London\nBright Sparks,Bristol')).toEqual([
      ['Name', 'City'],
      ['Acme Ltd', 'London'],
      ['Bright Sparks', 'Bristol'],
    ]);
  });

  it('handles quoted cells containing commas and embedded newlines', () => {
    const csv = 'Name,Notes\n"Acme, Ltd","Called twice.\nStill interested."';
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Notes'],
      ['Acme, Ltd', 'Called twice.\nStill interested.'],
    ]);
  });

  it('handles escaped double quotes inside a quoted cell', () => {
    expect(parseCsv('Name\n"Bob ""The Builder"" Smith"')).toEqual([
      ['Name'],
      ['Bob "The Builder" Smith'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('A,B\r\n1,2\r\n3,4')).toEqual([['A', 'B'], ['1', '2'], ['3', '4']]);
  });

  it('is the exact inverse of toCsv for round-trippable input', () => {
    const headers = ['Name', 'Notes'];
    const rows = [['Acme, Ltd', 'Line one\nLine two'], ['Plain Co', 'No special chars']];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/csv.test.ts`
Expected: FAIL with "parseCsv is not a function" (the export doesn't exist yet).

- [ ] **Step 3: Add `parseCsv` to `src/lib/csv.ts`**

Add this function to the end of the existing file (the `cell`/`toCsv` functions
above it stay exactly as they are):

```typescript
/** RFC-4180 CSV parser: quoted cells, escaped "" quotes, CRLF/LF rows. Returns raw
 * string cells with no type coercion — the header row is rows[0]. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  function endCell() {
    row.push(cell);
    cell = '';
  }
  function endRow() {
    endCell();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }
    if (char === '"') { inQuotes = true; i += 1; continue; }
    if (char === ',') { endCell(); i += 1; continue; }
    if (char === '\r') { i += 1; continue; }
    if (char === '\n') { endRow(); i += 1; continue; }
    cell += char;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/csv.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean (79 tests: 73 existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv.ts src/lib/csv.test.ts
git commit -m "feat: add parseCsv (RFC-4180 CSV parser)"
```

---

### Task 2: Types — widen `ScrapeSource`, add `ScrapeJob.pipeline_id`, add Dream Agent action types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: nothing beyond what already exists.
- Produces: `ScrapeSource` includes `'csv_upload'`; `RawLead.source` includes
  `'csv_upload'`; `ScrapeJob.pipeline_id: string | null`; new `DreamAgentUpdatePatch`
  and `DreamAgentAction` types. Every later task in this plan imports these.

- [ ] **Step 1: Widen `ScrapeSource`**

Find and change:

```typescript
export type ScrapeSource = 'google_places' | 'companies_house';
```

to:

```typescript
export type ScrapeSource = 'google_places' | 'companies_house' | 'csv_upload';
```

- [ ] **Step 2: Add `pipeline_id` to `ScrapeJob`**

Find the `ScrapeJob` interface's `icp_params` field and add the new field directly
after it:

```typescript
  icp_params: IcpParams | null;
  pipeline_id: string | null;
```

- [ ] **Step 3: Widen `RawLead.source`**

Find and change:

```typescript
  source: 'google_places' | 'companies_house';
```

to:

```typescript
  source: 'google_places' | 'companies_house' | 'csv_upload';
```

- [ ] **Step 4: Add the Dream Agent action types**

Add after the closing brace of the existing `LeadSuggestion` interface:

```typescript
/** Same shape as LeadSuggestion's field-update keys, minus the top-level
 * `rationale` string — Dream Agent carries excerpt/rationale on the action itself
 * (DreamAgentAction below), not nested inside the patch. `pain_point` stays
 * display-only, same as it already is for LeadSuggestion/SuggestionDiff — there's
 * no Lead column for it, so it's shown in the diff but never written anywhere. */
export interface DreamAgentUpdatePatch {
  stage?: Stage;
  deal_value?: number;
  package_tier?: PackageTier;
  next_action_date?: string;
  next_action_note?: string;
  pain_point?: string;
}

/** One proposed change from parse-session-notes. `lead_id`/`candidate_lead_ids`
 * always reference ids from the lead index the caller sent — never trust these
 * without validating against that same set client-side (see sanitizeDreamAgentActions
 * in src/lib/dreamAgentActions.ts). */
export type DreamAgentAction =
  | { type: 'update'; lead_id: string; business_name: string; patch: DreamAgentUpdatePatch; excerpt: string; rationale: string }
  | { type: 'create'; extracted: { business_name: string; owner_name: string | null; phone: string | null; email: string | null; website: string | null; city: string | null; vertical: string | null }; excerpt: string; rationale: string }
  | { type: 'ambiguous'; mentioned_text: string; candidate_lead_ids: string[]; excerpt: string };
```

- [ ] **Step 5: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean. (`tsc` may briefly fail if a consumer of `ScrapeJob`/`RawLead`
constructs a literal missing the new field before Task 2 finishes — verify no such
literal exists by searching: `grep -rn "ScrapeJob = {" src/` and
`grep -rn "RawLead = {" src/` should return nothing, since every existing usage reads
these types from Supabase queries via `as ScrapeJob`/`as RawLead` casts, not literal
construction.)

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: widen ScrapeSource for CSV imports, add Dream Agent action types"
```

---

### Task 3: `scrape_jobs.pipeline_id` migration

**Files:**
- Create: `supabase/migrations/021_scrape_jobs_pipeline.sql`

**Interfaces:**
- Produces: `scrape_jobs.pipeline_id UUID REFERENCES pipelines(id)`, nullable (existing
  rows get `NULL`; it's a client-side default only — the actual RLS gate on creating a
  `leads` row still happens at approval time via the already-reviewed
  `can_insert_lead_into` policy, so this column needs no RLS of its own). Task 6
  (`parse-csv-leads`) and Task 13 (Scraper's pipeline choice) both set it on insert;
  Task 12 (`ScraperJob.tsx`) reads it as the picker's default.

- [ ] **Step 1: Write the migration**

```sql
-- Lets a scrape job (real scrape or CSV import) carry a resolved target pipeline
-- as the review page's default, set once up front rather than re-picked per row.
-- Nullable and RLS-free by design: the real access gate is leads_insert's
-- can_insert_lead_into(pipeline_id) check at actual approval time (migration 018),
-- already reviewed — this column is a convenience default, not a second gate.
ALTER TABLE scrape_jobs ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool: `apply_migration` with `project_id: "wgomksxelyfkzepbnkdd"`,
`name: "scrape_jobs_pipeline"`, `query` = the SQL above.

- [ ] **Step 3: Verify**

Run via the Supabase MCP `execute_sql` tool:

```sql
SELECT column_name, is_nullable, data_type FROM information_schema.columns
WHERE table_name = 'scrape_jobs' AND column_name = 'pipeline_id';
```

Expected: one row, `is_nullable = 'YES'`, `data_type = 'uuid'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_scrape_jobs_pipeline.sql
git commit -m "feat: add scrape_jobs.pipeline_id"
```

---

### Task 4: `usePipelineActions.createPipeline` returns the created pipeline

**Files:**
- Modify: `src/hooks/usePipelineActions.ts`
- Modify: `src/pages/PipelineManage.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createPipeline(name: string): Promise<{ error: string | null; pipeline:
  Pipeline | null }>` — widened from `Promise<string | null>`, matching the shape
  `forkPipeline` already established. Task 6 (CSV flow) and Task 13 (Scraper's "new
  pipeline" option) both need the created pipeline's id immediately, not just a
  success/failure signal.

- [ ] **Step 1: Widen `createPipeline` in `src/hooks/usePipelineActions.ts`**

Change:

```typescript
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
```

to:

```typescript
  const createPipeline = useCallback(async (name: string): Promise<{ error: string | null; pipeline: Pipeline | null }> => {
    if (!currentOrg) return { error: 'No organization selected', pipeline: null };
    if (!name.trim()) return { error: 'Name is required', pipeline: null };
    const { data, error } = await supabase.from('pipelines')
      .insert({ org_id: currentOrg.id, name: name.trim(), created_by: session?.user.id })
      .select('*').single();
    if (error) return { error: error.message, pipeline: null };
    await refresh();
    return { error: null, pipeline: data as Pipeline };
  }, [currentOrg, session, refresh]);
```

- [ ] **Step 2: Update `PipelineManage.tsx`'s `handleCreate` to match**

Change:

```typescript
  async function handleCreate() {
    setError(null);
    const err = await createPipeline(newName);
    if (err) setError(err);
    else setNewName('');
  }
```

to:

```typescript
  async function handleCreate() {
    setError(null);
    const { error: err } = await createPipeline(newName);
    if (err) setError(err);
    else setNewName('');
  }
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePipelineActions.ts src/pages/PipelineManage.tsx
git commit -m "feat: createPipeline returns the created pipeline"
```

---

### Task 5: `dreamAgentActions` — pure action-sanitizing helper

**Files:**
- Create: `src/lib/dreamAgentActions.ts`
- Test: `src/lib/dreamAgentActions.test.ts` (new)

**Interfaces:**
- Consumes: `DreamAgentAction`, `DreamAgentUpdatePatch`, `Stage`, `PackageTier` types
  (Task 2).
- Produces: `sanitizeDreamAgentActions(raw: unknown, validLeadIds: Set<string>):
  DreamAgentAction[]` — whitelist-validates the AI's raw JSON response before it ever
  reaches state, mirroring the established `sanitizeSuggestion` pattern in
  `SuggestionDiff.tsx`. Every `lead_id`/`candidate_lead_ids` entry is checked against
  `validLeadIds` (the exact set of ids sent to the AI in the lead index) — an id the
  AI returns that wasn't in that set is dropped, never trusted. Consumed by Task 8
  (`useDreamAgentSession`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dreamAgentActions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sanitizeDreamAgentActions } from './dreamAgentActions';

const VALID_IDS = new Set(['lead-1', 'lead-2']);

describe('sanitizeDreamAgentActions', () => {
  it('keeps a valid update action referencing a known lead id', () => {
    const raw = [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'contacted', deal_value: 500 }, excerpt: 'Called Acme', rationale: 'They confirmed interest' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'contacted', deal_value: 500 }, excerpt: 'Called Acme', rationale: 'They confirmed interest' }]);
  });

  it('drops an update action referencing a lead id outside the valid set', () => {
    const raw = [{ type: 'update', lead_id: 'lead-999', business_name: 'Acme', patch: {}, excerpt: 'x', rationale: 'y' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('drops invalid patch fields but keeps valid ones on an update action', () => {
    const raw = [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'not_a_real_stage', deal_value: 500, package_tier: 'nonsense' }, excerpt: 'x', rationale: 'y' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { deal_value: 500 }, excerpt: 'x', rationale: 'y' }]);
  });

  it('keeps a valid create action', () => {
    const raw = [{ type: 'create', extracted: { business_name: 'Bright Sparks', owner_name: null, phone: '01234', email: null, website: null, city: 'Bristol', vertical: null }, excerpt: 'Followed up with Bright Sparks', rationale: 'New prospect mentioned' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual(raw);
  });

  it('drops a create action missing a business_name', () => {
    const raw = [{ type: 'create', extracted: { business_name: '', owner_name: null, phone: null, email: null, website: null, city: null, vertical: null }, excerpt: 'x', rationale: 'y' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('keeps a valid ambiguous action, filtering candidate ids to the valid set', () => {
    const raw = [{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-1', 'lead-2', 'lead-999'], excerpt: 'x' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-1', 'lead-2'], excerpt: 'x' }]);
  });

  it('drops an ambiguous action left with zero valid candidates', () => {
    const raw = [{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-999'], excerpt: 'x' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('drops an action with an unrecognized type', () => {
    expect(sanitizeDreamAgentActions([{ type: 'delete', lead_id: 'lead-1' }], VALID_IDS)).toEqual([]);
  });

  it('returns an empty array for a non-array input', () => {
    expect(sanitizeDreamAgentActions({ not: 'an array' }, VALID_IDS)).toEqual([]);
    expect(sanitizeDreamAgentActions(null, VALID_IDS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/dreamAgentActions.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write `src/lib/dreamAgentActions.ts`**

```typescript
import type { DreamAgentAction, DreamAgentUpdatePatch, PackageTier, Stage } from '../types';

const STAGE_VALUES = new Set<Stage>([
  'new_lead', 'contacted', 'audit_booked', 'proposal_sent',
  'negotiating', 'won', 'lost', 'not_now_nurture',
]);
const PACKAGE_TIER_VALUES = new Set<PackageTier>([
  'pilot_systems', 'pilot_ai_app', 'pilot_full_build',
  'automation_sprint', 'ai_foundation', 'full_build',
  'retainer_bronze', 'retainer_silver', 'retainer_gold', 'custom',
]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LEN = 500;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function sanitizedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LEN) : undefined;
}

function sanitizePatch(raw: unknown): DreamAgentUpdatePatch {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const patch: DreamAgentUpdatePatch = {};
  if (typeof r.stage === 'string' && STAGE_VALUES.has(r.stage as Stage)) patch.stage = r.stage as Stage;
  if (typeof r.package_tier === 'string' && PACKAGE_TIER_VALUES.has(r.package_tier as PackageTier)) patch.package_tier = r.package_tier as PackageTier;
  if (typeof r.deal_value === 'number' && Number.isFinite(r.deal_value) && r.deal_value >= 0) patch.deal_value = r.deal_value;
  if (typeof r.next_action_date === 'string' && isValidDateOnly(r.next_action_date)) patch.next_action_date = r.next_action_date;
  const nextActionNote = sanitizedString(r.next_action_note);
  if (nextActionNote !== undefined) patch.next_action_note = nextActionNote;
  const painPoint = sanitizedString(r.pain_point);
  if (painPoint !== undefined) patch.pain_point = painPoint;
  return patch;
}

/**
 * Whitelist-validates parse-session-notes' raw response before it ever reaches
 * state or the UI — mirrors sanitizeSuggestion's established pattern for the
 * single-lead parse-notes flow. `validLeadIds` is the exact set of lead ids sent
 * to the AI in the lead index; any lead_id/candidate id outside that set is
 * dropped, never trusted — the AI is never a source of truth for which leads exist.
 */
export function sanitizeDreamAgentActions(raw: unknown, validLeadIds: Set<string>): DreamAgentAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: DreamAgentAction[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;

    if (r.type === 'update') {
      if (typeof r.lead_id !== 'string' || !validLeadIds.has(r.lead_id)) continue;
      const businessName = sanitizedString(r.business_name);
      if (businessName === undefined) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      const rationale = sanitizedString(r.rationale) ?? '';
      actions.push({ type: 'update', lead_id: r.lead_id, business_name: businessName, patch: sanitizePatch(r.patch), excerpt, rationale });
      continue;
    }

    if (r.type === 'create') {
      if (typeof r.extracted !== 'object' || r.extracted === null) continue;
      const e = r.extracted as Record<string, unknown>;
      const businessName = sanitizedString(e.business_name);
      if (!businessName) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      const rationale = sanitizedString(r.rationale) ?? '';
      actions.push({
        type: 'create',
        extracted: {
          business_name: businessName,
          owner_name: sanitizedString(e.owner_name) ?? null,
          phone: sanitizedString(e.phone) ?? null,
          email: sanitizedString(e.email) ?? null,
          website: sanitizedString(e.website) ?? null,
          city: sanitizedString(e.city) ?? null,
          vertical: sanitizedString(e.vertical) ?? null,
        },
        excerpt, rationale,
      });
      continue;
    }

    if (r.type === 'ambiguous') {
      const mentionedText = sanitizedString(r.mentioned_text);
      if (mentionedText === undefined) continue;
      const rawCandidates = Array.isArray(r.candidate_lead_ids) ? r.candidate_lead_ids : [];
      const candidateIds = rawCandidates.filter((id): id is string => typeof id === 'string' && validLeadIds.has(id));
      if (candidateIds.length === 0) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      actions.push({ type: 'ambiguous', mentioned_text: mentionedText, candidate_lead_ids: candidateIds, excerpt });
      continue;
    }
  }

  return actions;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/dreamAgentActions.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean (88 tests: 79 + 9 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dreamAgentActions.ts src/lib/dreamAgentActions.test.ts
git commit -m "feat: add sanitizeDreamAgentActions (whitelist validation for AI output)"
```

---

### Task 6: `parse-session-notes` edge function

**Files:**
- Modify: `supabase/functions/_shared/ai.ts`
- Create: `supabase/functions/parse-session-notes/index.ts`

**Interfaces:**
- Consumes: `resolveOrgApiKey`, `corsHeaders`/`json` from `_shared/` (existing).
- Produces: deployed edge function `parse-session-notes` accepting `{ org_id: string,
  pipeline_id: string | null, messages: string[] }` (`pipeline_id: null` means
  "whole platform" — every pipeline the caller can see in that org; a real id scopes
  matching to just that pipeline), returning `{ actions: unknown[] }` (raw, unsanitized
  — Task 8's client code runs it through `sanitizeDreamAgentActions`) or `{ actions:
  [], error: string }` on failure. Consumed by Task 8.

- [ ] **Step 1: Add `parseSessionNotes` to `supabase/functions/_shared/ai.ts`**

Add this function after the existing `parseNotes` function:

```typescript
/**
 * Multi-lead note parsing: compares a whole conversation (original note + any
 * free-text refinements) against a lead index and proposes update/create/ambiguous
 * actions across however many leads it touches. Unlike parseNotes (one lead, one
 * patch), this is genuinely one-to-many — stateless like every AI call in this app,
 * the caller resends the full conversation each round rather than this function
 * tracking any server-side state. Throws on failure.
 */
export async function parseSessionNotes(input: {
  messages: string[]; leadIndex: { id: string; business_name: string; city: string | null; stage: string }[]; apiKey: string;
}): Promise<unknown> {
  return await geminiJson(
`You extract CRM actions from a sales rep's session notes. The rep may mention
multiple companies in one note, and may send follow-up messages correcting or
clarifying an earlier one — always re-read the WHOLE conversation and produce a
fresh, complete list of actions, not just what changed.

For each company/person mentioned, decide one of three action types:
1. "update" — confidently matches one of the leads in LEAD INDEX below. Output:
   {"type":"update","lead_id":<id from LEAD INDEX>,"business_name":<their name>,
   "patch":{<only fields that should change, keys from: stage (one of new_lead,
   contacted, audit_booked, proposal_sent, negotiating, won, lost,
   not_now_nurture), deal_value (number, GBP), package_tier (one of pilot_systems,
   pilot_ai_app, pilot_full_build, automation_sprint, ai_foundation, full_build,
   retainer_bronze, retainer_silver, retainer_gold, custom), next_action_date
   (YYYY-MM-DD), next_action_note (string), pain_point (string)>},
   "excerpt":<the relevant sentence(s) from the note>,"rationale":<one sentence
   explaining the match and the changes>}
2. "create" — mentions someone NOT in LEAD INDEX at all, a genuinely new prospect.
   Output: {"type":"create","extracted":{"business_name":<string>,
   "owner_name":<string or null>,"phone":<string or null>,"email":<string or
   null>,"website":<string or null>,"city":<string or null>,"vertical":<string or
   null>},"excerpt":<relevant text>,"rationale":<one sentence>}
3. "ambiguous" — could plausibly match 2+ leads in LEAD INDEX, or the name is too
   vague to resolve alone. Output: {"type":"ambiguous","mentioned_text":<what was
   said>,"candidate_lead_ids":[<ids from LEAD INDEX>],"excerpt":<relevant text>}

Only emit an action for something a genuine business update/mention was made about —
do not invent actions for names that only appear in passing. Today is
${new Date().toISOString().slice(0, 10)}. Return a JSON array of actions (empty
array if nothing found).

LEAD INDEX: ${JSON.stringify(input.leadIndex)}

CONVERSATION (each entry is one message from the rep, in order):
${JSON.stringify(input.messages)}`,
    input.apiKey,
  );
}
```

- [ ] **Step 2: Write `supabase/functions/parse-session-notes/index.ts`**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseSessionNotes } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

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

  const body = (await req.json()) as { org_id?: string; pipeline_id?: string | null; messages?: string[] };
  const orgId = String(body.org_id ?? '');
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => typeof m === 'string' && m.trim()) : [];
  if (!orgId || messages.length === 0) return json({ actions: [], error: 'org_id and at least one message are required' }, 400, headers);

  // RLS applies on this query — the caller's own JWT client, so the lead index
  // (and therefore every lead_id the AI can ever reference) is already scoped to
  // exactly what they're allowed to see. Whole-platform mode omits the pipeline
  // filter but still can't cross an org boundary, since org_id is fixed here.
  let query = client.from('leads').select('id, business_name, city, stage, pipeline_id').eq('org_id', orgId);
  if (body.pipeline_id) query = query.eq('pipeline_id', body.pipeline_id);
  const { data: leads, error: leadsErr } = await query;
  if (leadsErr) return json({ actions: [], error: leadsErr.message }, 400, headers);
  const leadIndex = (leads ?? []).map((l) => ({ id: l.id as string, business_name: l.business_name as string, city: l.city as string | null, stage: l.stage as string }));

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ actions: [], error: 'AI unavailable' }, 200, headers);

  try {
    const actions = await parseSessionNotes({ messages, leadIndex, apiKey });
    return json({ actions }, 200, headers);
  } catch (e) {
    console.error('parse-session-notes failed:', e);
    return json({ actions: [], error: 'AI unavailable' }, 200, headers);
  }
});
```

- [ ] **Step 3: Deploy the edge function**

Use the Supabase MCP tool: `deploy_edge_function` with `project_id:
"wgomksxelyfkzepbnkdd"`, `name: "parse-session-notes"`, `entrypoint_path:
"index.ts"`, `verify_jwt: true`, and `files` containing the file above.

- [ ] **Step 4: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean (no new tests — this task has no client-side testable logic;
`_shared/ai.ts` and edge functions have no existing test coverage in this codebase,
matching established convention).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/parse-session-notes/index.ts
git commit -m "feat: add parse-session-notes edge function (multi-lead note parsing)"
```

---

### Task 7: `parse-csv-leads` edge function

**Files:**
- Modify: `supabase/functions/_shared/ai.ts`
- Create: `supabase/functions/parse-csv-leads/index.ts`

**Interfaces:**
- Consumes: `resolveOrgApiKey`, `corsHeaders`/`json` (existing).
- Produces: deployed edge function `parse-csv-leads` accepting `{ org_id: string,
  pipeline_id: string, pipeline_is_new: boolean, pipeline_name: string, csv_headers:
  string[], rows: string[][] }` and returning `{ job_id: string, mapped_count:
  number, duplicate_count: number, unmapped_count: number } | { error: string }`.
  `pipeline_id` is required when `pipeline_is_new` is `false`; when `true`, the
  function creates the pipeline itself (server-side, since the AI call and the
  pipeline creation both need to happen before any `raw_leads` row can reference
  either). Consumed by Task 10 (Dream Agent CSV tab).

- [ ] **Step 1: Add `mapCsvColumns` to `supabase/functions/_shared/ai.ts`**

Add this function after `parseSessionNotes`:

```typescript
/**
 * Infers a CSV column → lead-field mapping from headers + a few sample rows. This
 * is the ONLY AI call in the CSV flow — per-row extraction and duplicate detection
 * are deterministic (see parse-csv-leads/index.ts), so this stays cheap regardless
 * of how many rows the file actually has. Throws on failure.
 */
export async function mapCsvColumns(input: { headers: string[]; sampleRows: string[][]; apiKey: string }): Promise<unknown> {
  return await geminiJson(
`Map these CSV column headers to CRM lead fields. Valid target fields:
business_name (required — the company/organisation name), owner_name, phone, email,
website, address, city, postcode, vertical (industry/sector). A header maps to at
most one field; a field may be left unmapped if no header fits. Use the sample rows
to judge intent when a header name alone is ambiguous (e.g. a column of email
addresses maps to "email" even if its header is just "Contact"). Return JSON:
{"mapping":{<header string>:<one of the field names above, or null if unmapped>}}.

HEADERS: ${JSON.stringify(input.headers)}
SAMPLE ROWS: ${JSON.stringify(input.sampleRows)}`,
    input.apiKey,
  );
}
```

- [ ] **Step 2: Write `supabase/functions/parse-csv-leads/index.ts`**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { mapCsvColumns } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const LEAD_FIELDS = ['business_name', 'owner_name', 'phone', 'email', 'website', 'address', 'city', 'postcode', 'vertical'] as const;
type LeadField = typeof LEAD_FIELDS[number];

function sanitizeMapping(raw: unknown, headers: string[]): Partial<Record<LeadField, string>> {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = (raw as { mapping?: unknown }).mapping;
  if (typeof r !== 'object' || r === null) return {};
  const entries = Object.entries(r as Record<string, unknown>);
  const result: Partial<Record<LeadField, string>> = {};
  const usedFields = new Set<string>();
  for (const [header, field] of entries) {
    if (!headers.includes(header)) continue;
    if (typeof field !== 'string' || !LEAD_FIELDS.includes(field as LeadField)) continue;
    if (usedFields.has(field)) continue; // first mapping to a given field wins
    result[field as LeadField] = header;
    usedFields.add(field);
  }
  return result;
}

function isDuplicate(seen: { business_name: string; city: string | null; email: string | null }[], businessName: string, city: string | null, email: string | null): boolean {
  return seen.some((s) =>
    (s.email && email && s.email.toLowerCase() === email.toLowerCase()) ||
    (s.business_name.toLowerCase() === businessName.toLowerCase() && (s.city ?? '').toLowerCase() === (city ?? '').toLowerCase()),
  );
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as {
    org_id?: string; pipeline_id?: string; pipeline_is_new?: boolean; pipeline_name?: string;
    csv_headers?: string[]; rows?: string[][];
  };
  const orgId = String(body.org_id ?? '');
  const csvHeaders = Array.isArray(body.csv_headers) ? body.csv_headers : [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!orgId || csvHeaders.length === 0 || rows.length === 0) return json({ error: 'org_id, csv_headers, and rows are required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve the target pipeline. New-pipeline creation goes through the caller's
  // own RLS-scoped client (not service role) so pipelines_insert's own checks
  // (org membership, is_default=false, created_by=self) apply exactly as they
  // would from the UI — this function isn't a privilege-widening shortcut.
  let pipelineId = String(body.pipeline_id ?? '');
  if (body.pipeline_is_new) {
    const name = String(body.pipeline_name ?? '').trim();
    if (!name) return json({ error: 'pipeline_name is required for a new pipeline' }, 400, headers);
    const { data: newPipeline, error: pipelineErr } = await client
      .from('pipelines').insert({ org_id: orgId, name, created_by: caller.id }).select('id').single();
    if (pipelineErr || !newPipeline) return json({ error: pipelineErr?.message ?? 'Could not create pipeline' }, 400, headers);
    pipelineId = newPipeline.id as string;
  }
  if (!pipelineId) return json({ error: 'pipeline_id is required' }, 400, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ error: 'AI unavailable — configure a Gemini key for this organization' }, 400, headers);

  let mapping: Partial<Record<LeadField, string>>;
  try {
    const raw = await mapCsvColumns({ headers: csvHeaders, sampleRows: rows.slice(0, 5), apiKey });
    mapping = sanitizeMapping(raw, csvHeaders);
  } catch (e) {
    console.error('mapCsvColumns failed:', e);
    return json({ error: 'AI unavailable' }, 400, headers);
  }
  if (!mapping.business_name) return json({ error: 'Could not identify a business name column in this file' }, 400, headers);

  const { data: existingLeads } = await service.from('leads').select('business_name, city, email').eq('org_id', orgId);
  const seen = (existingLeads ?? []) as { business_name: string; city: string | null; email: string | null }[];

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: caller.id, icp_raw_input: null, icp_params: null,
    sources: ['csv_upload'], status: 'completed', pipeline_id: pipelineId,
    results_count: rows.length, completed_at: new Date().toISOString(),
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create import job' }, 500, headers);

  function cell(row: string[], field: LeadField): string | null {
    const header = mapping[field];
    if (!header) return null;
    const idx = csvHeaders.indexOf(header);
    const value = idx >= 0 ? row[idx]?.trim() : '';
    return value ? value : null;
  }

  let mappedCount = 0;
  let duplicateCount = 0;
  let unmappedCount = 0;
  const toInsert: Record<string, unknown>[] = [];

  for (const row of rows) {
    const businessName = cell(row, 'business_name');
    if (!businessName) { unmappedCount += 1; continue; }
    const city = cell(row, 'city');
    const email = cell(row, 'email');
    const duplicate = isDuplicate(seen, businessName, city, email);
    if (duplicate) duplicateCount += 1; else mappedCount += 1;
    toInsert.push({
      scrape_job_id: job.id, business_name: businessName, owner_name: cell(row, 'owner_name'),
      phone: cell(row, 'phone'), email, website: cell(row, 'website'), address: cell(row, 'address'),
      city, postcode: cell(row, 'postcode'), vertical: cell(row, 'vertical'),
      source: 'csv_upload', status: duplicate ? 'duplicate' : 'pending',
    });
    seen.push({ business_name: businessName, city, email });
  }

  if (toInsert.length > 0) {
    const { error: insertErr } = await service.from('raw_leads').insert(toInsert);
    if (insertErr) return json({ error: insertErr.message }, 500, headers);
  }

  return json({ job_id: job.id, mapped_count: mappedCount, duplicate_count: duplicateCount, unmapped_count: unmappedCount }, 200, headers);
});
```

- [ ] **Step 3: Deploy the edge function**

Use the Supabase MCP tool: `deploy_edge_function` with `project_id:
"wgomksxelyfkzepbnkdd"`, `name: "parse-csv-leads"`, `entrypoint_path: "index.ts"`,
`verify_jwt: true`, and `files` containing the file above.

- [ ] **Step 4: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/parse-csv-leads/index.ts
git commit -m "feat: add parse-csv-leads edge function (CSV column mapping + import)"
```

---

### Task 8: `useSpeechRecognition` — voice input hook

**Files:**
- Create: `src/hooks/useSpeechRecognition.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useSpeechRecognition(onResult: (text: string) => void)` → `{
  isSupported: boolean, isListening: boolean, start: () => void, stop: () => void }`.
  Consumed by Task 9 (Dream Agent notes tab).

- [ ] **Step 1: Write `src/hooks/useSpeechRecognition.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

// Not in the standard TS DOM lib yet — Chrome/Edge/Safari ship a working
// implementation under one of these two global names.
interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Wraps the browser's SpeechRecognition API (Web Speech API) — live, continuous
 * transcription with no backend, no per-use cost. `onResult` fires with the full
 * accumulated transcript text each time the browser reports a result; the caller
 * decides how to use it (e.g. append to a textarea). isSupported is false in any
 * browser without a working implementation — callers should hide/disable voice
 * input entirely rather than show a broken button.
 */
export function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SpeechRecognitionCtor = getSpeechRecognition();
  const isSupported = SpeechRecognitionCtor !== null;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor || isListening) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-GB';
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
      onResult(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [SpeechRecognitionCtor, isListening, onResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isSupported, isListening, start, stop };
}
```

- [ ] **Step 2: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean. (No test file for this hook — it wraps a browser API with no
jsdom implementation, matching this codebase's existing convention of not
unit-testing browser-API-dependent hooks; verified manually once Task 9 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSpeechRecognition.ts
git commit -m "feat: add useSpeechRecognition (browser voice-input wrapper)"
```

---

### Task 9: `useDreamAgentSession` — conversation + action-resolution state

**Files:**
- Create: `src/hooks/useDreamAgentSession.ts`

**Interfaces:**
- Consumes: `sanitizeDreamAgentActions` (Task 5), `DreamAgentAction` type (Task 2),
  `applyLeadUpdate`/`LeadPatch` (existing `src/lib/leadUpdates.ts`), `useAuth()` →
  `{ session }`, `useOrg()` → `{ currentOrg }`.
- Produces: `useDreamAgentSession()` → `{ messages: string[], actions:
  DreamAgentAction[], resolutions: Record<number, ActionResolution>, loading: boolean,
  error: string | null, sendMessage: (text: string, matchPipelineId: string | null) =>
  Promise<void>, resolveAction: (index: number, resolution: ActionResolution) => void,
  confirmAll: () => Promise<void> }`, where `ActionResolution` is exported from this
  same file. Consumed by Task 10 (Dream Agent notes tab UI).

- [ ] **Step 1: Write `src/hooks/useDreamAgentSession.ts`**

```typescript
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { sanitizeDreamAgentActions } from '../lib/dreamAgentActions';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { DreamAgentAction, DreamAgentUpdatePatch, Lead } from '../types';

export type ActionResolution =
  | { status: 'pending' }
  | { status: 'dismissed' }
  | { status: 'confirmed_update' }
  | { status: 'confirmed_create'; pipeline_id: string }
  | { status: 'confirmed_ambiguous_as_lead'; lead_id: string }
  | { status: 'confirmed_ambiguous_as_new'; business_name: string; pipeline_id: string };

/**
 * Owns one Dream Agent conversation: the growing list of user messages (the
 * original note plus any free-text refinements), the AI's latest full action
 * list, and each action's per-row resolution state. Nothing here writes to the
 * database except confirmAll, and only for actions whose resolution status starts
 * with "confirmed_" — every other action is silently discarded, matching the
 * guardrail: nothing applies without an explicit confirm.
 */
export function useDreamAgentSession() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [messages, setMessages] = useState<string[]>([]);
  const [actions, setActions] = useState<DreamAgentAction[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, ActionResolution>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string, matchPipelineId: string | null) => {
    if (!currentOrg || !text.trim()) return;
    setLoading(true);
    setError(null);
    const nextMessages = [...messages, text.trim()];
    const { data, error: invokeErr } = await supabase.functions.invoke('parse-session-notes', {
      body: { org_id: currentOrg.id, pipeline_id: matchPipelineId, messages: nextMessages },
    });
    setLoading(false);
    if (invokeErr) { setError(invokeErr.message); return; }
    const result = data as { actions?: unknown; error?: string };
    if (result.error) { setError(result.error); return; }
    // sanitizeDreamAgentActions must validate against the lead index the AI was
    // actually given, not against its output — re-fetch that same RLS-scoped
    // index here rather than trusting any id the response happens to reference.
    let query = supabase.from('leads').select('id').eq('org_id', currentOrg.id);
    if (matchPipelineId) query = query.eq('pipeline_id', matchPipelineId);
    const { data: leadRows } = await query;
    const validIds = new Set((leadRows ?? []).map((l) => l.id as string));
    const sanitized = sanitizeDreamAgentActions(result.actions, validIds);
    setMessages(nextMessages);
    setActions(sanitized);
    setResolutions(Object.fromEntries(sanitized.map((_, i) => [i, { status: 'pending' } as ActionResolution])));
  }, [currentOrg, messages]);

  const resolveAction = useCallback((index: number, resolution: ActionResolution) => {
    setResolutions((prev) => ({ ...prev, [index]: resolution }));
  }, []);

  // pain_point is display-only, same as SuggestionDiff's existing "info only" row —
  // there's no Lead column for it, and it's deliberately never written anywhere.
  function patchToLeadPatch(patch: DreamAgentUpdatePatch): LeadPatch {
    const result: LeadPatch = {};
    if (patch.stage) result.stage = patch.stage;
    if (patch.deal_value !== undefined) result.deal_value = patch.deal_value;
    if (patch.package_tier) result.package_tier = patch.package_tier;
    if (patch.next_action_date) result.next_action_date = patch.next_action_date;
    if (patch.next_action_note) result.next_action_note = patch.next_action_note;
    return result;
  }

  const confirmAll = useCallback(async () => {
    if (!currentOrg || !session) return;
    setLoading(true);
    setError(null);
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      const resolution = resolutions[i];
      if (!resolution || !resolution.status.startsWith('confirmed_')) continue;

      if (action.type === 'update' && resolution.status === 'confirmed_update') {
        const { data: before } = await supabase.from('leads').select('*').eq('id', action.lead_id).single();
        const err = await applyLeadUpdate(action.lead_id, patchToLeadPatch(action.patch), before as Lead | null, session.user.id);
        if (err) { setError(err); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: action.lead_id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}\n\n${action.rationale}`,
        });
      }

      if (action.type === 'create' && resolution.status === 'confirmed_create') {
        const { data: newLead, error: insertErr } = await supabase.from('leads').insert({
          business_name: action.extracted.business_name, owner_name: action.extracted.owner_name,
          phone: action.extracted.phone, email: action.extracted.email, website: action.extracted.website,
          city: action.extracted.city, vertical: action.extracted.vertical, stage: 'new_lead',
          org_id: currentOrg.id, pipeline_id: resolution.pipeline_id, created_by: session.user.id,
        }).select('id').single();
        if (insertErr) { setError(insertErr.message); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: newLead.id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}\n\n${action.rationale}`,
        });
      }

      if (action.type === 'ambiguous' && resolution.status === 'confirmed_ambiguous_as_lead') {
        await supabase.from('lead_notes').insert({
          lead_id: resolution.lead_id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}`,
        });
      }

      if (action.type === 'ambiguous' && resolution.status === 'confirmed_ambiguous_as_new') {
        const { data: newLead, error: insertErr } = await supabase.from('leads').insert({
          business_name: resolution.business_name, stage: 'new_lead',
          org_id: currentOrg.id, pipeline_id: resolution.pipeline_id, created_by: session.user.id,
        }).select('id').single();
        if (insertErr) { setError(insertErr.message); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: newLead.id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}`,
        });
      }
    }
    setLoading(false);
    setActions([]);
    setResolutions({});
    setMessages([]);
  }, [actions, resolutions, currentOrg, session]);

  return { messages, actions, resolutions, loading, error, sendMessage, resolveAction, confirmAll };
}
```

- [ ] **Step 2: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean. (No dedicated test file — this hook is a thin orchestration
layer over already-tested pure logic (`sanitizeDreamAgentActions`,
`applyLeadUpdate`) and live Supabase calls, matching this codebase's convention of
not unit-testing hooks that are mostly network orchestration; verified manually once
Task 10 wires it into a real page.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDreamAgentSession.ts
git commit -m "feat: add useDreamAgentSession (conversation + action resolution state)"
```

---

### Task 10: Dream Agent page — notes tab

**Files:**
- Create: `src/pages/DreamAgent.tsx`
- Create: `src/components/dreamAgent/ActionRow.tsx`

**Interfaces:**
- Consumes: `useDreamAgentSession` (Task 9), `useSpeechRecognition` (Task 8),
  `usePipeline()` → `{ currentPipeline, pipelines }`, `useOrg()` → `{ currentOrg }`.
- Produces: `DreamAgent` page component (notes tab only — Task 11 adds the CSV tab
  to this same file), `ActionRow` component rendering one `DreamAgentAction` +
  its resolution controls.

- [ ] **Step 1: Write `src/components/dreamAgent/ActionRow.tsx`**

```tsx
import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { formatCurrency, packageLabel, stageInfo } from '../../lib/utils';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import type { ActionResolution } from '../../hooks/useDreamAgentSession';
import type { DreamAgentAction, Lead, Pipeline } from '../../types';

interface ActionRowProps {
  action: DreamAgentAction;
  resolution: ActionResolution;
  leadsById: Record<string, Lead>;
  pipelines: Pipeline[];
  /** The single pipeline the user scoped this note to ("Match against"), or null
   * for whole-platform mode. A `create`/`ambiguous-as-new` action targets THIS
   * pipeline automatically when set — it must never fall back to an arbitrary
   * pipeline (e.g. pipelines[0]), which would silently create the lead in the
   * wrong place. */
  scopedPipelineId: string | null;
  needsPipelinePicker: boolean;
  onResolve: (resolution: ActionResolution) => void;
}

/** One proposed action from Dream Agent, resolved by the user before it can be
 * confirmed. `update` renders a from/to diff (matching SuggestionDiff's pattern);
 * `create` shows extracted fields + a pipeline picker if needed; `ambiguous` shows
 * a candidate picker plus "this is someone new", which itself becomes a create-like
 * picker step rather than guessing a pipeline. */
export function ActionRow({ action, resolution, leadsById, pipelines, scopedPipelineId, needsPipelinePicker, onResolve }: ActionRowProps) {
  const [promotedToNew, setPromotedToNew] = useState(false);

  if (action.type === 'update') {
    const lead = leadsById[action.lead_id];
    const rows: { label: string; from: string; to: string }[] = [];
    if (action.patch.stage && lead && action.patch.stage !== lead.stage) rows.push({ label: 'Stage', from: stageInfo(lead.stage).label, to: stageInfo(action.patch.stage).label });
    if (action.patch.deal_value !== undefined) rows.push({ label: 'Deal value', from: lead?.deal_value != null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(action.patch.deal_value) });
    if (action.patch.package_tier) rows.push({ label: 'Package', from: packageLabel(lead?.package_tier ?? null), to: packageLabel(action.patch.package_tier) });
    if (action.patch.next_action_date) rows.push({ label: 'Next action date', from: lead?.next_action_date ?? '—', to: action.patch.next_action_date });
    if (action.patch.next_action_note) rows.push({ label: 'Next action', from: lead?.next_action_note ?? '—', to: action.patch.next_action_note });
    if (action.patch.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: action.patch.pain_point });
    const confirmed = resolution.status === 'confirmed_update';
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />{action.business_name}</p>
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
              <span className="w-36 text-xs font-semibold text-muted">{r.label}</span>
              <span className="text-muted line-through">{r.from}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
              <span className="font-semibold text-success">{r.to}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{action.rationale}</p>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          <Button variant={confirmed ? 'secondary' : 'primary'} onClick={() => onResolve({ status: 'confirmed_update' })}>
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  if (action.type === 'create') {
    const confirmed = resolution.status === 'confirmed_create';
    const pipelineId = resolution.status === 'confirmed_create' ? resolution.pipeline_id : (scopedPipelineId ?? '');
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />New lead: {action.extracted.business_name}</p>
        <p className="text-xs text-muted">{[action.extracted.city, action.extracted.phone, action.extracted.email].filter(Boolean).join(' · ') || 'No extra details found'}</p>
        <p className="text-xs text-muted">{action.rationale}</p>
        {needsPipelinePicker && (
          <SelectField label="Pipeline" value={pipelineId} onChange={(e) => onResolve({ status: 'confirmed_create', pipeline_id: e.target.value })}>
            <option value="">Choose pipeline…</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          <Button
            variant={confirmed ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !pipelineId}
            onClick={() => onResolve({ status: 'confirmed_create', pipeline_id: pipelineId })}
          >
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  // ambiguous
  if (promotedToNew) {
    const confirmedAsNew = resolution.status === 'confirmed_ambiguous_as_new';
    const newPipelineId = resolution.status === 'confirmed_ambiguous_as_new' ? resolution.pipeline_id : (scopedPipelineId ?? '');
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />New lead: {action.mentioned_text}</p>
        <p className="text-xs text-muted">{action.excerpt}</p>
        {needsPipelinePicker && (
          <SelectField label="Pipeline" value={newPipelineId} onChange={(e) => onResolve({ status: 'confirmed_ambiguous_as_new', business_name: action.mentioned_text, pipeline_id: e.target.value })}>
            <option value="">Choose pipeline…</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setPromotedToNew(false)}>Back</Button>
          <Button
            variant={confirmedAsNew ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !newPipelineId}
            onClick={() => onResolve({ status: 'confirmed_ambiguous_as_new', business_name: action.mentioned_text, pipeline_id: newPipelineId })}
          >
            {confirmedAsNew ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  const asLeadSelected = resolution.status === 'confirmed_ambiguous_as_lead' ? resolution.lead_id : '';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />Not sure who "{action.mentioned_text}" is</p>
      <p className="text-xs text-muted">{action.excerpt}</p>
      <SelectField
        label="Which lead did you mean?"
        value={asLeadSelected}
        onChange={(e) => onResolve({ status: 'confirmed_ambiguous_as_lead', lead_id: e.target.value })}
      >
        <option value="">Choose…</option>
        {action.candidate_lead_ids.map((id) => (
          <option key={id} value={id}>{leadsById[id]?.business_name ?? id}</option>
        ))}
      </SelectField>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Skip</Button>
        <Button variant="ghost" onClick={() => setPromotedToNew(true)}>
          This is someone new
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/pages/DreamAgent.tsx`**

```tsx
import { useState } from 'react';
import { Mic, Send, Sparkles } from 'lucide-react';
import { useDreamAgentSession } from '../hooks/useDreamAgentSession';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { usePipeline } from '../hooks/usePipeline';
import { useOrg } from '../hooks/useOrg';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { SelectField, Textarea } from '../components/ui/Input';
import { ActionRow } from '../components/dreamAgent/ActionRow';
import type { Lead } from '../types';

/** Dream Agent: free-form session notes (typed or voice) parsed into confirm-before-
 * apply lead updates across however many leads a note touches. */
export function DreamAgent() {
  const { currentOrg } = useOrg();
  const { currentPipeline, pipelines } = usePipeline();
  const { messages, actions, resolutions, loading, error, sendMessage, resolveAction, confirmAll } = useDreamAgentSession();
  const [draft, setDraft] = useState('');
  const [matchScope, setMatchScope] = useState<string>(currentPipeline?.id ?? '');
  const [leadsById, setLeadsById] = useState<Record<string, Lead>>({});

  const { isSupported: micSupported, isListening, start, stop } = useSpeechRecognition((text) => setDraft(text));

  const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg?.id);
  const matchPipelineId = matchScope || null;

  async function handleSend() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    await sendMessage(text, matchPipelineId);
    // Refresh the lead lookup used to render "from" values on update rows.
    if (!currentOrg) return;
    let query = supabase.from('leads').select('*').eq('org_id', currentOrg.id);
    if (matchPipelineId) query = query.eq('pipeline_id', matchPipelineId);
    const { data } = await query;
    const byId: Record<string, Lead> = {};
    for (const l of (data as Lead[] | null) ?? []) byId[l.id] = l;
    setLeadsById(byId);
  }

  const anyConfirmed = Object.values(resolutions).some((r) => r.status.startsWith('confirmed_'));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Dream Agent</h1>
      </header>

      <div className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <p key={i} className="rounded-xl border border-line bg-surface/60 p-4 text-sm">{m}</p>
        ))}
        {actions.map((action, i) => (
          <ActionRow
            key={i}
            action={action}
            resolution={resolutions[i] ?? { status: 'pending' }}
            leadsById={leadsById}
            pipelines={orgPipelines}
            scopedPipelineId={matchPipelineId}
            needsPipelinePicker={!matchPipelineId}
            onResolve={(resolution) => resolveAction(i, resolution)}
          />
        ))}
        {actions.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={() => void confirmAll()} disabled={!anyConfirmed || loading}>
              {loading ? 'Applying…' : 'Apply confirmed changes'}
            </Button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <SelectField label="Match against" value={matchScope} onChange={(e) => setMatchScope(e.target.value)}>
          <option value="">Whole platform</option>
          {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <Textarea
          label={messages.length === 0 ? 'What happened in your session?' : 'Add a correction or more detail'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
        />
        <div className="flex items-center justify-between">
          {micSupported && (
            <Button variant={isListening ? 'secondary' : 'ghost'} onClick={() => (isListening ? stop() : start())}>
              <Mic className="h-4 w-4" aria-hidden />
              {isListening ? 'Listening…' : 'Voice note'}
            </Button>
          )}
          <Button onClick={() => void handleSend()} disabled={!draft.trim() || loading}>
            <Send className="h-4 w-4" aria-hidden />
            {loading ? 'Thinking…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/dreamAgent/ActionRow.tsx src/pages/DreamAgent.tsx
git commit -m "feat: add Dream Agent page (notes tab)"
```

---

### Task 11: Sidebar + App.tsx wiring

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `DreamAgent` page component (Task 10).
- Produces: route `/dream-agent`, a new Sidebar nav entry.

- [ ] **Step 1: Add the nav item in `src/components/layout/Sidebar.tsx`**

Change the import line:

```typescript
import { BarChart3, Contact, KanbanSquare, LayoutDashboard, Mail, Phone, Radar, Rocket, Settings, Shield } from 'lucide-react';
```

to:

```typescript
import { BarChart3, Contact, KanbanSquare, LayoutDashboard, Mail, Phone, Radar, Rocket, Settings, Shield, Sparkles } from 'lucide-react';
```

Change the `NAV_ITEMS` array — add the Dream Agent entry right after Dashboard:

```typescript
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dream-agent', label: 'Dream Agent', icon: Sparkles },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/scraper', label: 'Scraper', icon: Radar },
  { to: '/outreach/linkedin', label: 'LinkedIn', icon: Contact },
  { to: '/outreach/autopilot', label: 'Autopilot', icon: Rocket },
  { to: '/dialer', label: 'Power Dialer', icon: Phone },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];
```

- [ ] **Step 2: Add the route in `src/App.tsx`**

Add the import alongside the other page imports:

```typescript
import { DreamAgent } from './pages/DreamAgent';
```

Add the route right after the `/` (Dashboard) route:

```tsx
              <Route path="/" element={<Dashboard />} />
              <Route path="/dream-agent" element={<DreamAgent />} />
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/App.tsx
git commit -m "feat: add Dream Agent to the nav and route tree"
```

---

### Task 12: `ScraperJob.tsx` — default to the resolved pipeline, bulk "select all + approve"

**Files:**
- Modify: `src/pages/ScraperJob.tsx`

**Interfaces:**
- Consumes: `approve` from `useRawLeadActions` (existing, unchanged signature);
  `job.pipeline_id` (Task 3's new column, already returned by the existing
  `useScrapeJob` hook's `select('*')` query — no hook change needed).
- Produces: no new exports — two UI/behavior additions to the existing page: the
  pipeline picker now defaults to whatever pipeline was resolved when the job was
  created (a real scrape's wizard choice, Task 13; a CSV import's choice, Task 7),
  instead of always falling back to the org's default pipeline; and a bulk
  "select all + approve" action, needed by both a real scrape's results (many rows)
  and CSV imports so a large batch doesn't require approving one row at a time.

- [ ] **Step 1: Prefer `job.pipeline_id` as the picker's default**

This page already has a `useEffect` (from the earlier multi-pipeline plan) that
resolves `pipelineId`'s default once `job` loads — today it only ever falls back to
the org's default pipeline, never considering the specific pipeline the job itself
was created against. Change:

```tsx
  useEffect(() => {
    if (!job) return;
    setPipelineId((current) => {
      const stillValid = pipelines.find((p) => p.id === current && p.org_id === job.org_id);
      if (stillValid) return current;
      const orgDefault = pipelines.find((p) => p.org_id === job.org_id && p.is_default);
      return orgDefault?.id ?? '';
    });
  }, [job, pipelines]);
```

to:

```tsx
  useEffect(() => {
    if (!job) return;
    setPipelineId((current) => {
      const stillValid = pipelines.find((p) => p.id === current && p.org_id === job.org_id);
      if (stillValid) return current;
      const resolved = job.pipeline_id && pipelines.some((p) => p.id === job.pipeline_id) ? job.pipeline_id : null;
      const orgDefault = pipelines.find((p) => p.org_id === job.org_id && p.is_default);
      return resolved ?? orgDefault?.id ?? '';
    });
  }, [job, pipelines]);
```

The user can still change the selection via the existing dropdown either way — this
only changes which pipeline is pre-selected.

- [ ] **Step 2: Add selection state and a bulk-approve handler**

In `src/pages/ScraperJob.tsx`, add `useState` for the selected-row set — change:

```tsx
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
```

to:

```tsx
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
```

Add a bulk-approve function alongside the existing `runAction`:

```typescript
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  async function approveSelected(leads: RawLead[]) {
    setBulkBusy(true);
    for (const lead of leads) {
      if (!selected.has(lead.id)) continue;
      const err = await approve(lead);
      if (err) setRowError({ id: lead.id, text: err });
    }
    setBulkBusy(false);
    setSelected(new Set());
    void refresh();
  }
```

- [ ] **Step 3: Add the "select all" checkbox and "Approve selected" button to the header**

Change:

```tsx
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

to:

```tsx
        <div className="flex items-center gap-3">
          <SelectField label="Approve into" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Choose pipeline…</option>
            {pipelines.filter((p) => p.org_id === job.org_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectField>
          {selected.size > 0 && (
            <Button onClick={() => void approveSelected(pending)} disabled={bulkBusy || !pipelineId}>
              {bulkBusy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
          )}
          <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
        </div>
      </header>
```

Note: `pending` (the filtered array of `pending`/`duplicate` rows) is already computed
via `const pending = rawLeads.filter((l) => l.status === 'pending' || l.status ===
'duplicate');`, positioned directly above the `return (` statement — before the JSX
that now references it in the header. No line needs to move; this reuses that
existing variable as-is.

- [ ] **Step 4: Add the header checkbox and per-row checkboxes to the table**

Change the table header:

```tsx
            <tr className="border-b border-line text-xs text-muted">
              <th className="p-3">Business</th>
```

to:

```tsx
            <tr className="border-b border-line text-xs text-muted">
              <th className="p-3">
                <input type="checkbox" checked={selected.size > 0 && selected.size === pending.length} onChange={() => toggleSelectAll(pending.map((l) => l.id))} className="h-4 w-4 accent-violet-500" aria-label="Select all" />
              </th>
              <th className="p-3">Business</th>
```

Change the row rendering — find:

```tsx
              <tr key={lead.id} className={`border-b border-line ${lead.status === 'duplicate' ? 'bg-amber-500/10' : ''}`}>
                <td className="p-3 font-semibold">
```

and change to:

```tsx
              <tr key={lead.id} className={`border-b border-line ${lead.status === 'duplicate' ? 'bg-amber-500/10' : ''}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelected(lead.id)} className="h-4 w-4 accent-violet-500" aria-label={`Select ${lead.business_name}`} />
                </td>
                <td className="p-3 font-semibold">
```

- [ ] **Step 5: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ScraperJob.tsx
git commit -m "feat: default the review pipeline to job.pipeline_id, add bulk select+approve"
```

---

### Task 13: Scraper pipeline choice — `scrape-google-places`/`scrape-companies-house` + `Scraper.tsx`

**Files:**
- Modify: `supabase/functions/scrape-google-places/index.ts`
- Modify: `supabase/functions/scrape-companies-house/index.ts`
- Modify: `src/pages/Scraper.tsx`

**Interfaces:**
- Consumes: `usePipeline()` → `{ pipelines }`, `usePipelineActions()` →
  `{ createPipeline }` (Task 4's widened signature).
- Produces: both scrape edge functions accept and store `pipeline_id` on the
  `scrape_jobs` row they create; `Scraper.tsx`'s wizard resolves a pipeline (existing
  or newly-created) before triggering the scrape.

- [ ] **Step 1: Thread `pipeline_id` through `scrape-google-places`**

In `supabase/functions/scrape-google-places/index.ts`, change the body type and
`scrape_jobs` insert. Find:

```typescript
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number };
```

change to:

```typescript
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number; pipeline_id?: string };
```

Find:

```typescript
  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: callerId, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['google_places'], status: 'pending',
  }).select('id').single();
```

change to:

```typescript
  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: callerId, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['google_places'], status: 'pending',
    pipeline_id: body.pipeline_id ?? null,
  }).select('id').single();
```

- [ ] **Step 2: Thread `pipeline_id` through `scrape-companies-house`**

In `supabase/functions/scrape-companies-house/index.ts`, find:

```typescript
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number };
```

change to:

```typescript
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number; pipeline_id?: string };
```

Find:

```typescript
  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: callerId, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['companies_house'], status: 'pending',
  }).select('id').single();
```

change to:

```typescript
  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: callerId, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['companies_house'], status: 'pending',
    pipeline_id: body.pipeline_id ?? null,
  }).select('id').single();
```

- [ ] **Step 3: Deploy both edge functions**

Use the Supabase MCP `deploy_edge_function` tool twice, `project_id:
"wgomksxelyfkzepbnkdd"`, once for `name: "scrape-google-places"` and once for `name:
"scrape-companies-house"`, each with `entrypoint_path: "index.ts"`, `verify_jwt:
true`, and the full updated file content for `files`.

- [ ] **Step 4: Add the pipeline-choice step to `Scraper.tsx`**

Add the import:

```typescript
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineActions } from '../hooks/usePipelineActions';
```

Add state near the other `useState` calls:

```typescript
  const { pipelines } = usePipeline();
  const { createPipeline } = usePipelineActions();
  const [pipelineChoice, setPipelineChoice] = useState<'existing' | 'new'>('existing');
  const [pipelineId, setPipelineId] = useState('');
  const [newPipelineName, setNewPipelineName] = useState('');
```

Change `runScrape` to resolve a pipeline first:

```typescript
  async function runScrape() {
    if (!currentOrg || !icp) return;
    setBusy(true); setError(null);
    let targetPipelineId = pipelineId;
    if (pipelineChoice === 'new') {
      const { error: createErr, pipeline } = await createPipeline(newPipelineName);
      if (createErr || !pipeline) { setBusy(false); setError(createErr ?? 'Could not create pipeline'); return; }
      targetPipelineId = pipeline.id;
    }
    const functionName = source === 'google_places' ? 'scrape-google-places' : 'scrape-companies-house';
    const { data, error: err } = await supabase.functions.invoke(functionName, {
      body: { org_id: currentOrg.id, icp_raw_input: rawInput, icp_params: icp, pipeline_id: targetPipelineId || null },
    });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { job_id?: string; error?: string };
    if (result.error) return setError(result.error);
    if (result.job_id) navigate(`/scraper/jobs/${result.job_id}`);
  }
```

- [ ] **Step 5: Add the pipeline-choice UI to step 4's card**

`Scraper.tsx` currently imports only `Textarea` from `'../components/ui/Input'`.
Change:

```typescript
import { Textarea } from '../components/ui/Input';
```

to:

```typescript
import { Input, SelectField, Textarea } from '../components/ui/Input';
```

Change step 4's card body — find:

```tsx
      {step === 4 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Ready to search {source === 'google_places' ? 'Google Places' : 'Companies House'}</p>
            <p className="text-sm text-muted">This runs in the background — you'll be taken to a live results page.</p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={() => void runScrape()} disabled={busy}>{busy ? 'Starting…' : 'Find leads'}</Button>
            </div>
          </div>
        </Card>
      )}
```

to:

```tsx
      {step === 4 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Ready to search {source === 'google_places' ? 'Google Places' : 'Companies House'}</p>
            <p className="text-sm text-muted">This runs in the background — you'll be taken to a live results page.</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="pipeline-choice" checked={pipelineChoice === 'existing'} onChange={() => setPipelineChoice('existing')} className="h-4 w-4 accent-violet-500" />
              Add results to an existing pipeline
            </label>
            {pipelineChoice === 'existing' && (
              <SelectField label="Pipeline" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                <option value="">Choose pipeline…</option>
                {pipelines.filter((p) => p.org_id === currentOrg?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
            )}
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="pipeline-choice" checked={pipelineChoice === 'new'} onChange={() => setPipelineChoice('new')} className="h-4 w-4 accent-violet-500" />
              Create a new pipeline for these results
            </label>
            {pipelineChoice === 'new' && (
              <Input label="New pipeline name" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} />
            )}
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button
                onClick={() => void runScrape()}
                disabled={busy || (pipelineChoice === 'existing' && !pipelineId) || (pipelineChoice === 'new' && !newPipelineName.trim())}
              >
                {busy ? 'Starting…' : 'Find leads'}
              </Button>
            </div>
          </div>
        </Card>
      )}
```

- [ ] **Step 6: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/scrape-google-places/index.ts supabase/functions/scrape-companies-house/index.ts src/pages/Scraper.tsx
git commit -m "feat: add pipeline choice to the scraper wizard"
```

---

### Task 14: Dream Agent page — CSV tab, and Pipeline Manage's 3-way create-pipeline flow

**Files:**
- Modify: `src/pages/DreamAgent.tsx`
- Modify: `src/pages/PipelineManage.tsx`

**Interfaces:**
- Consumes: `parseCsv` (Task 1), `parse-csv-leads` edge function (Task 7),
  `usePipeline()` → `{ pipelines }`, `useNavigate` from `react-router`.
- Produces: a CSV tab on the Dream Agent page (reachable directly, and as the
  target of Pipeline Manage's "CSV upload" create option); Pipeline Manage's
  "Create pipeline" section gains the manual/CSV/scrape choice.

- [ ] **Step 1: Add the CSV tab to `src/pages/DreamAgent.tsx`**

Add imports:

```typescript
import { useNavigate } from 'react-router';
import { parseCsv } from '../lib/csv';
```

Add a `tab` state near the top of the component body:

```typescript
  const navigate = useNavigate();
  const [tab, setTab] = useState<'notes' | 'csv'>('notes');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPipelineChoice, setCsvPipelineChoice] = useState<'existing' | 'new'>('existing');
  const [csvPipelineId, setCsvPipelineId] = useState('');
  const [csvNewPipelineName, setCsvNewPipelineName] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
```

Add the upload handler:

```typescript
  async function handleCsvUpload() {
    if (!csvFile || !currentOrg) return;
    setCsvBusy(true); setCsvError(null);
    const text = await csvFile.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { setCsvBusy(false); setCsvError('This file has no data rows.'); return; }
    const [csvHeaders, ...dataRows] = rows;
    const { data, error: invokeErr } = await supabase.functions.invoke('parse-csv-leads', {
      body: {
        org_id: currentOrg.id,
        pipeline_id: csvPipelineChoice === 'existing' ? csvPipelineId : undefined,
        pipeline_is_new: csvPipelineChoice === 'new',
        pipeline_name: csvPipelineChoice === 'new' ? csvNewPipelineName : undefined,
        csv_headers: csvHeaders, rows: dataRows,
      },
    });
    setCsvBusy(false);
    if (invokeErr) { setCsvError(invokeErr.message); return; }
    const result = data as { job_id?: string; error?: string };
    if (result.error) { setCsvError(result.error); return; }
    if (result.job_id) navigate(`/scraper/jobs/${result.job_id}`);
  }
```

Change the returned JSX's header area to add tabs — find:

```tsx
      <header className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Dream Agent</h1>
      </header>
```

to:

```tsx
      <header className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Dream Agent</h1>
      </header>

      <div className="flex overflow-hidden rounded-lg border border-line" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'notes' ? 'bg-violet/25' : 'text-muted'}`}>
          Session notes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'csv'} onClick={() => setTab('csv')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'csv' ? 'bg-violet/25' : 'text-muted'}`}>
          Upload CSV
        </button>
      </div>

      {tab === 'csv' && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="csv-pipeline-choice" checked={csvPipelineChoice === 'existing'} onChange={() => setCsvPipelineChoice('existing')} className="h-4 w-4 accent-violet-500" />
            Add to an existing pipeline
          </label>
          {csvPipelineChoice === 'existing' && (
            <SelectField label="Pipeline" value={csvPipelineId} onChange={(e) => setCsvPipelineId(e.target.value)}>
              <option value="">Choose pipeline…</option>
              {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="csv-pipeline-choice" checked={csvPipelineChoice === 'new'} onChange={() => setCsvPipelineChoice('new')} className="h-4 w-4 accent-violet-500" />
            Create a new pipeline
          </label>
          {csvPipelineChoice === 'new' && (
            <input type="text" placeholder="New pipeline name" value={csvNewPipelineName} onChange={(e) => setCsvNewPipelineName(e.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-cyan" />
          )}
          <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {csvError && <p role="alert" className="text-sm text-danger">{csvError}</p>}
          <Button
            onClick={() => void handleCsvUpload()}
            disabled={csvBusy || !csvFile || (csvPipelineChoice === 'existing' && !csvPipelineId) || (csvPipelineChoice === 'new' && !csvNewPipelineName.trim())}
          >
            {csvBusy ? 'Uploading…' : 'Upload and review'}
          </Button>
        </div>
      )}

      {tab === 'notes' && (
      <>
```

Then, at the very end of the returned JSX, close the fragment right before the final
closing `</div>` of the page's outer wrapper — find the last lines of the file:

```tsx
        </div>
      </div>
    </div>
  );
}
```

and change to:

```tsx
        </div>
      </div>
      </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the manual/CSV/scrape choice to `PipelineManage.tsx`**

`useNavigate` is already imported in this file (used by `handleFork`) — no import
change needed for this step.

Change the "Create pipeline" section — find:

```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Your pipelines</h2>
        <div className="flex items-end gap-3">
          <Input label="New pipeline name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={() => void handleCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            Create
          </Button>
        </div>
```

to:

```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Your pipelines</h2>
        <div className="flex items-end gap-3">
          <Input label="New pipeline name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={() => void handleCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            Create empty
          </Button>
          <Button variant="secondary" onClick={() => navigate('/dream-agent')}>
            Create via CSV upload
          </Button>
          <Button variant="secondary" onClick={() => navigate('/scraper')}>
            Create via scrape
          </Button>
        </div>
```

- [ ] **Step 3: Run the type-checker and test suite**

Run: `npx tsc --noEmit && npx vitest run --pool=threads`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DreamAgent.tsx src/pages/PipelineManage.tsx
git commit -m "feat: add Dream Agent CSV tab, wire Pipeline Manage's create-pipeline options"
```
