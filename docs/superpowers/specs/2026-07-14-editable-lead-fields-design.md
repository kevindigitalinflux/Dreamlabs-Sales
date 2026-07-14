# Editable Lead Fields — Design

**Date:** 2026-07-14 · **Status:** Approved by Kevin

## Problem

After a lead is created, Package, Deal value, Vertical, and Google rating cannot be
changed — `PipelineInfo` renders read-only rows, and Google rating was never capturable
at all (reserved for the cycle-2 scraper). Contact details (phone, email, website,
address) have the same gap.

## Decision (approved)

Inline save-on-blur editing (option A), contact fields included.

## Design

`ContactInfo` and `PipelineInfo` in `src/components/pipeline/LeadPanelSections.tsx`
become editable, following the `NextActionEditor` pattern: local state initialised from
the lead, save on blur only when the value changed, per-section "Saving… / Saved ✓ /
error" status line. Both gain an `onSave(patch: LeadPatch): Promise<string | null>`
prop. Call sites already hold the right updater:

- `LeadPanel` → `onSave={(patch) => onUpdate(lead.id, patch)}`
- `LeadDetailPage` → `onSave={(patch) => updateLead(patch)}`

### Pipeline section

| Field | Input | Notes |
|---|---|---|
| Package | select from `PACKAGE_TIERS` (+ "Not set") | same options as Add-lead wizard |
| Deal value (£) | number, min 0 | empty → `null` |
| Vertical | text | empty → `null` |
| Google rating | number 0–5 step 0.1 | clamped; empty → `null` |
| Review count | number, min 0 | empty → `null` |
| Calls made | **read-only** | derived from call notes |
| Last contacted | **read-only** | derived from call notes |

### Contact section

Phone, Email, Website, Address, City, Postcode — text inputs, empty → `null`.
Each of phone/email/website keeps a tap-to-act icon link beside the input
(`tel:` / `mailto:` / open in new tab) shown when the saved value is present, so
one-tap calling from the panel is preserved.

## Out of scope

- Editing call stats or stage from these sections (stage select already exists above).
- Any change to AddLeadWizard, useLeads, leadUpdates, or RLS.

## Testing

Typecheck + existing unit tests (no pure-logic change). Browser: edit each field from
the side panel and the detail page; blur; confirm persisted value in DB and reflected
in the other surface.
