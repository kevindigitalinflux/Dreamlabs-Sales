# Dreamlabs Sales — Build Cycle 1 Design (Phases 1–3)

**Date:** 2026-07-12
**Status:** Approved by Kevin
**Source of truth:** `SPEC.md` in the project root (Product Specification MVP v1.0). This document does not restate the spec — it records the scope of this build cycle, the decisions that deviate from or clarify the spec, and the rationale.

---

## 1. Scope of this cycle

Build Phases 1–3 of the spec's MVP build order (SPEC.md §14):

1. **Phase 1 — Foundation:** Supabase project + full schema migration, auth (email/password, session persistence), route structure with role guards (admin vs contractor), app shell (sidebar, topbar, mobile breakpoints), profile creation on first sign-in, admin invite + role management.
2. **Phase 2 — Pipeline Tracker:** Lead CRUD, 8-column Kanban with drag-and-drop (`@dnd-kit`), list view (sort/filter/search), compact + expanded lead cards, lead detail page, note logging (free text first, then structured debrief), next-action system with overdue detection.
3. **Phase 3 — Dashboard:** Today's Focus widget, stats bar, pipeline snapshot, focus mode toggle.

**Explicitly out of scope for this cycle** (later cycles, each with its own plan): email automation (Phase 4), lead scraper (Phase 5), analytics (Phase 6), Cloudflare Pages deployment, mobile-specific FAB flows beyond responsive breakpoints.

The full database schema (all 9 tables, including email/scraper tables) IS in scope now — it ships as `001_initial_schema.sql` so later cycles are purely additive and never modify migration 001 (a spec "Do Not Touch" rule).

## 2. Decisions and deltas from SPEC.md

| Decision | Spec said | We're doing | Rationale |
|---|---|---|---|
| Project location | — | `C:\Users\kevin\Projects\dreamlabs-sales` | Kevin's choice; alongside other active projects |
| Tailwind | v3, `tailwind.config.js` | **v4, CSS-first `@theme` config** | Current stable; design tokens (`--color-navy` etc.) map directly to `@theme` CSS variables |
| React | 18 | **19** | Current stable; long support runway |
| Router | React Router v6 | **react-router v7, library mode** | Same API surface as v6; current package |
| Git/GitHub | Auto-deploy from GitHub main | **GitHub repo from commit one; Cloudflare Pages deferred** until Phases 1–3 verified locally | Git discipline from the start without deploying half-built screens |
| Supabase | — | **New hosted project**, created by Kevin in the dashboard; URL + anon key into `.env` | No local Docker setup needed |
| Gemini model | `gemini-1.5-flash` | **`gemini-2.5-flash`** when Phases 4–5 arrive (no action this cycle) | 1.5-flash is deprecated; 2.5-flash retains a free tier |
| Admin RLS policies | `(SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'` inline in each policy | **`is_admin()` SECURITY DEFINER helper function**, used by all admin policies | The spec's `profiles_admin_read` policy queries `profiles` from within a `profiles` policy → infinite recursion error in Postgres. Same behaviour, no recursion, and consistent across all tables |

## 3. Architecture summary

- **Frontend:** Vite + React 19 + TypeScript strict + Tailwind v4. Structure per CLAUDE.md project tree (`components/ui`, `components/layout`, `components/pipeline`, `components/dashboard`, `pages/`, `lib/`, `hooks/`, `types/`).
- **Data layer:** Custom hooks over `supabase-js` — `useAuth` (session + role), `useLeads` (CRUD + real-time subscription). **No TanStack Query** — considered and rejected: the app's data needs are simple and the spec's hook design is sufficient; avoid an unearned dependency.
- **Database:** Supabase Postgres, schema per SPEC.md §3 with the `is_admin()` amendment. RLS on every table; database is the security boundary, frontend role checks are UX only.
- **Design system:** Dark-mode-only navy theme per SPEC.md §11. ADHD/dyslexia rules enforced from the first component: icon + colour + label for every status, 44×44px tap targets, skeleton loaders (no spinners), `prefers-reduced-motion` respected, 16px body floor, one primary action per screen. Fonts (Montserrat + DM Sans) self-hosted in `src/assets/fonts/`.
- **Error handling:** Every component handles loading / error / empty states (CLAUDE.md convention). Supabase errors surface as inline, human-readable messages — never silent failures.

## 4. Testing & verification

- **Vitest** for pure logic: date/overdue helpers, stage colour maps, and (later cycles) duplicate detection.
- **Browser verification at localhost** for UI, per the AIXD development loop in CLAUDE.md.
- **RLS verification:** test as both an admin user and a contractor user — contractor must not see the other's leads; role column must not be writable from the client.

## 5. Build sequencing

Follows SPEC.md §14 phase order. Each phase is independently testable and committed in small increments (`feat:`/`fix:`/`chore:` messages). Phase 1 must be verified (login works, roles enforced, shell renders) before Phase 2 begins.
