-- Corrects migration 016, which was based on a misdiagnosis and introduced a
-- privilege-escalation hole. profiles.UPDATE was never missing at table level for
-- authenticated -- migration 001 already granted it, but scoped to specific safe
-- columns only (full_name, avatar_url, updated_at), deliberately excluding
-- platform_role. Postgres reports a missing COLUMN privilege with the same generic
-- "permission denied for table profiles" message as a missing table privilege, which
-- is why the 42501 seen while building the theme toggle looked like a table-level gap.
-- The real gap was that theme_preference (added in migration 015) was never added to
-- the safe-column list.
--
-- Migration 016's untargeted `GRANT UPDATE ON public.profiles TO authenticated`
-- implicitly grants UPDATE on every column, including platform_role -- the column
-- that gates cross-org admin access in the admin-users and org-api-settings edge
-- functions. profiles_self_update's RLS only constrains which row (auth.uid() = id),
-- never which column, so this let any signed-in user grant themselves platform_admin.
-- This migration restores the column-scoped model and adds theme_preference to it.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, avatar_url, updated_at, theme_preference) ON public.profiles TO authenticated;
