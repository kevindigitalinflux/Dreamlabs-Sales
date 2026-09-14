# Multi-Pipeline Support — Design Spec

## Overview

Today every lead belongs to exactly one org (`leads.org_id`), and non-admin visibility is
per-lead (`created_by`/`assigned_to`). This plan introduces **pipelines**: named,
ownable, shareable groupings of leads within an org. A user can have several pipelines
(e.g. "Q4 Dental Clinics", "Warm Referrals"), and a pipeline can be shared — read-only,
or as a fork a recipient can work independently — with a specific person, including a
person in a *different* org.

This is the foundation two other features depend on, per the user's own stated order:
a future "Sales Assistant" page (CSV upload asks which pipeline to populate) and an
autopilot enhancement (choose an existing pipeline vs. trigger a new scrape). Neither
is built in this plan — see Non-Goals.

## Data Model

```sql
CREATE TABLE pipelines (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES profiles(id),  -- NULL for the migration-created default
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_shares (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id        UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES profiles(id),
  permission         TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  shared_by          UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pipeline_id, shared_with_user_id)
);

ALTER TABLE leads ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE leads ADD COLUMN forked_from_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
-- pipeline_id made NOT NULL after the backfill migration (see Migration below)
```

`scrape_jobs`/`raw_leads` are **not** touched — they stay org-scoped exactly as today.
A raw lead only gains a `pipeline_id` at the moment it's approved into a real `leads`
row (see "Scraper integration" below), which is also the natural hook the future Sales
Assistant CSV flow will use.

`permission` on `pipeline_shares` has a narrower meaning than it sounds — see
"Sharing and forking" below: neither `view` nor `edit` grants a write on the *original*
pipeline. `edit` only unlocks the "Make my own copy" action.

## Access Control (RLS)

Two pairs of helper functions, `SECURITY DEFINER` like the existing
`is_org_admin`/`is_org_member`. **Pipeline-level** rights govern the `pipelines` table
itself — rename, delete, manage sharing. **Lead-level** rights govern `leads`/
`lead_notes`, and differ from pipeline-level rights specifically inside the default
pipeline (see "Default pipeline carve-out") — conflating the two was an inconsistency
in an earlier draft of this spec, caught in self-review before it reached a plan.

```sql
-- Pipeline-level: rename/delete/share. Never grants default-pipeline access to a
-- plain member — only the creator or an org admin manages a pipeline's metadata,
-- even the shared default one.
CREATE OR REPLACE FUNCTION can_view_pipeline(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id)
      OR p.created_by = auth.uid()
      OR (p.is_default AND is_org_member(p.org_id))  -- so members can see it exists in the switcher
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

-- Lead-level: read/write an individual lead. Inside a default pipeline this
-- reproduces today's exact created_by/assigned_to rule; inside a named pipeline it's
-- pure pipeline membership (see "Default pipeline carve-out").
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
```

`INSERT` on `leads` can't use these (there's no row yet to check), so it's checked
directly against the target pipeline: `is_org_admin(pipeline.org_id) OR
(pipeline.is_default AND is_org_member(pipeline.org_id)) OR (NOT pipeline.is_default
AND can_edit_pipeline(pipeline.id))` — a new lead inside a default pipeline is
createable by any org member (today's behavior), inside a named pipeline only by
someone who can actually edit it.

`pipelines` policies: `SELECT` via `can_view_pipeline(id)`; `INSERT` via
`is_org_member(org_id)` (Q4: anyone can create); `UPDATE`/`DELETE` via
`can_edit_pipeline(id)`.

`pipeline_shares` policies: `SELECT` via `shared_with_user_id = auth.uid() OR
can_edit_pipeline(pipeline_id)` (both the recipient and the pipeline's
owner/admin can see a share exists). `INSERT` via `can_edit_pipeline(pipeline_id) AND
is_org_member` of the pipeline's own org for the target user — this restricts direct
client-side inserts to **within-org shares only**; cross-org shares are only ever
created by the `pipeline-shares` edge function below, using the service role (which
bypasses this table-level restriction after its own authorization check). `DELETE` via
`can_edit_pipeline(pipeline_id) OR shared_with_user_id = auth.uid()` — the
owner/admin can revoke a share, and a recipient can remove their own access
("leave" a pipeline shared with them).

`leads`/`lead_notes` policies replace today's `leads_own_in_org`/`leads_org_admin`:
`SELECT` via `can_view_lead(id)`; `UPDATE`/`DELETE` via `can_edit_lead(id)`; `INSERT`
via the pipeline-targeted check above. `lead_notes` derives the same way it does
today, via a join to its parent lead.

**This is a real behavior change for non-default, newly-created pipelines**: a plain
`pipeline_shares` row (either permission level) only ever grants read on the *leads
inside it*. There is no RLS path for a shared user to write to someone else's
pipeline — "edit" access means "you may fork," never "you may write here." This is
what makes the cross-org billing question from the design discussion moot: no
cross-org write ever touches another org's data or triggers another org's AI/API
usage.

### Default pipeline carve-out

Today, a non-admin org member sees only leads where `created_by`/`assigned_to` match
them — not every lead in their org. If the migration simply dropped every existing
lead into one `is_default` pipeline gated by pure pipeline membership, those same
members would lose visibility into their *own* leads (they're not the pipeline's
`created_by`, and no explicit share exists for them).

So the lead-level functions above special-case `is_default = true` pipelines:
`created_by`/`assigned_to` continues to gate individual leads within it, exactly
today's behavior, for every org member (not just the pipeline's nominal creator, who
for the migration-generated default is `NULL` anyway). Named/custom pipelines created
going forward don't carry this extra filter: once you have pipeline access (owner,
admin, or an explicit share), you see every lead in it — that's the whole point of a
deliberately-created, shareable pipeline. This means the Default Pipeline reads as
"your existing general work queue, unchanged," and named pipelines are the new
"curated, shareable list" concept — nothing about existing workflows breaks.

A default pipeline can never be deleted, and every org always has exactly one
(enforced by the migration and by blocking deletion in the UI/API, not a DB constraint —
a partial unique index isn't warranted for four orgs). Pipeline-level metadata
(rename, share, delete) on the default pipeline stays admin/creator-only per
`can_edit_pipeline` above — a regular member who can work leads inside the shared
default pipeline still can't rename or delete it out from under everyone else.

## Sharing and Forking

**Within-org sharing:** any pipeline's creator (or an org admin) can share it with any
member of the *same* org, at `view` or `edit` permission, picked from the org's
existing member list (no lookup needed — mirrors how `AssignmentPanel` already works).

**Cross-org sharing:** restricted to org-admin-to-org-admin. The sharer must be an
admin of the pipeline's org; the recipient is specified by email and must be an admin
of *some* org (any org, not necessarily the sharer's). A new edge function
(`pipeline-shares`, service-role, mirroring `admin-users`'s pattern) does the lookup —
if no matching admin is found, it returns a generic "no matching admin found" error
rather than confirming whether the email exists at all, avoiding user-enumeration by
non-admins probing arbitrary addresses.

**Forking (the "Make my own copy" action):** available to anyone with `edit`
permission on a pipeline they don't own. It's on-demand, not automatic at share time —
per the confirmed design, this avoids accumulating forks of pipelines the recipient
never actually works, and captures a deliberate snapshot rather than an arbitrary
share-moment one. Forking:
1. Creates a new `pipelines` row: `org_id` = the forker's *currently selected* org,
   `created_by` = the forker, `name` defaulted to `"<original name> (copy)"` (editable).
2. Copies every lead currently in the source pipeline into new `leads` rows under the
   new pipeline, same `org_id` as the new pipeline, `created_by` = the forker,
   `forked_from_lead_id` set to the source lead's id (pure traceability — "this came
   from Suj's pipeline" — never a live link, nothing propagates back either direction).
3. From that point on the fork is a completely ordinary, independent pipeline: owned
   entirely by the forker's org, using that org's own API keys/autopilot budget for
   anything done with it. The original is untouched and keeps working normally for
   its owner.

The fork itself can be shared onward like any other pipeline the forker owns — e.g.
Kevin, after forking Suj's pipeline, can grant Suj `view` access back to Kevin's fork
so Suj can watch Kevin's progress. This needs no special-casing: `pipeline_shares` is
a uniform grant on whichever pipeline the sharer currently owns.

**UI requirement:** the "Make my own copy" CTA must be prominent wherever a
`view`/`edit`-shared pipeline (that the current user doesn't own) is open — a
persistent, high-contrast banner/button, not tucked into a menu, per explicit design
direction.

**Autopilot restriction:** autopilot only ever runs against pipelines the acting org
owns outright (never a pipeline merely shared *to* you, forked or not — actually a
fork IS owned outright once created, so this restriction really only excludes
running autopilot against someone else's un-forked shared pipeline, which the RLS
write-block above already prevents mechanically). No separate enforcement needed
beyond the RLS in "Access Control" — noted here so the eventual autopilot-integration
plan doesn't need to re-derive it.

## UI Changes

**Pipeline switcher** (new `PipelineSwitcher.tsx`, `usePipeline.tsx` hook — same shape
as `OrgSwitcher`/`useOrg`): sits in the top bar, lists pipelines owned in the current
org plus every pipeline shared with the user (any org), each labeled with its source
org if not the current one. Selecting one persists to `localStorage` (`current-pipeline`,
matching `useOrg`'s `current-org` key pattern) and scopes `useLeads` (Kanban/List) to
it — replacing today's plain `.eq('org_id', currentOrg.id)` query with an additional
`.eq('pipeline_id', currentPipeline.id)`.

**Pipeline management:** a new `/pipeline/manage` route, reached via a "Manage
pipelines" link in the `PipelineSwitcher` dropdown. Lists every pipeline the user owns
(create/rename/delete — delete only if empty, and never the default) plus, per owned
pipeline, its current shares with a revoke action next to each. A separate "Shared
with me" section lists incoming shares (any org) with a "leave" action and, for
`edit`-permission ones not yet forked, the "Make my own copy" CTA — this is the
prominent, persistent version of that CTA; a secondary copy of it also appears
directly on the Kanban/List page whenever the active pipeline is one you don't own.

**Scraper integration:** `ApprovalPanel`'s existing approve action gains a required
pipeline-select step (defaulting to the currently active pipeline) before inserting
the new `leads` row — this is the one existing flow that directly creates leads today,
so it can't ship without pipeline-awareness. The *Sales Assistant's* future CSV-upload
flow will reuse this same "which pipeline" decision point; it is not built here.

**Analytics:** deliberately stays an org-wide aggregate for this plan — it reflects
whatever leads the viewer can see across *all* their accessible pipelines in the
current org (a natural fallout of the RLS change, zero code change required beyond
what already exists). Adding an explicit per-pipeline filter is a reasonable fast
follow, not required for this plan to be useful, and is called out as a Non-Goal below
to keep this plan bounded.

## Migration

One migration:
1. Create `pipelines`, `pipeline_shares` tables and the two RLS helper functions above.
2. For each existing org, insert one `pipelines` row: `is_default = true`,
   `created_by = NULL`, `name = 'Default Pipeline'`.
3. Add `leads.pipeline_id` (nullable), backfill every existing lead to its org's new
   default pipeline, then `ALTER COLUMN pipeline_id SET NOT NULL`.
4. Add `leads.forked_from_lead_id` (nullable, no backfill needed).
5. Create the four helper functions (`can_view_pipeline`, `can_edit_pipeline`,
   `can_view_lead`, `can_edit_lead`); drop the old `leads_own_in_org`/`leads_org_admin`
   policies and replace with the `can_view_lead`/`can_edit_lead`/pipeline-targeted-INSERT
   ones above.
6. Update `lead_notes` policies the same way (currently derived from `leads.org_id`
   via a join to the parent lead — the join target changes to `can_view_lead`/
   `can_edit_lead` on that same parent lead, no structural change to the join itself).

No data loss, no visible change for any existing user on day one — everyone keeps
seeing exactly what they see today (via the default-pipeline carve-out), until they or
someone else creates and shares a named pipeline.

## Non-Goals (this plan)

- The "Sales Assistant" page itself (text/voice note capture, CSV-upload lead
  creation) — a separate future plan that builds on the pipeline-select hook added to
  `ApprovalPanel` here.
- Autopilot's "existing pipeline vs. new scrape" choice — a separate future plan;
  this plan only guarantees the RLS boundary (see "Autopilot restriction") that plan
  will rely on.
- Per-pipeline Analytics filtering (stays org-wide-aggregate for now).
- Share notifications (email/toast when someone shares a pipeline with you) — the
  recipient discovers it next time they open the pipeline switcher. Pure YAGNI for v1.
- Any change to `scrape_jobs`/`raw_leads` — they remain purely org-scoped.
