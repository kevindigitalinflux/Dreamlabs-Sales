import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const original = read('supabase/migrations/074_email_log_tier_snapshot.sql')
const migration = read('supabase/migrations/075_deep_find_check_queue.sql')
const audit = read('supabase/audits/deep_find_check_queue.sql')

it('has had its approval guard removed only after review and authorisation', () => {
  expect(migration).not.toMatch(/not approved yet/)
  expect(migration.trimStart()).toMatch(/^-- Reviewed by Claude; rolled-back production dry run passed 2026-11-13; Kevin authorised applying it\.\s*BEGIN;/)
})
it('extends only the two basis lists in the exact 074 constraint text', () => {
  const constraint = original.slice(original.indexOf('  ADD CONSTRAINT email_logs_tier_snapshot_shape'), original.indexOf(',\n  ADD CONSTRAINT email_logs_bounce_stamp_shape'))
  const extended = constraint.replace("'saved_non_guessed'", "'saved_non_guessed','ms_exists','role_confirmed'").replace("'weak_evidence'", "'weak_evidence','ms_not_found','saved_unproven'")
  expect(migration).toContain('DROP CONSTRAINT email_logs_tier_snapshot_shape;')
  expect(migration).toContain(extended + ';')
  expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.guard_email_log_recipient_evidence')
})
it('bounds candidates and scopes sibling cleanup to one lead', () => {
  expect(migration).toMatch(/ORDER BY q.rank,q.next_at,q.created_at,q.id LIMIT 200 FOR UPDATE OF q SKIP LOCKED/)
  expect(migration).toContain('proven.lead_id=q.lead_id')
})
it('recovers stale running claims before expiry and sibling cleanup without changing attempts', () => {
  const start = migration.indexOf('CREATE FUNCTION public.deep_find_checks_expire')
  const expire = migration.slice(start, migration.indexOf('REVOKE ALL ON FUNCTION', start))
  const recovery = expire.slice(expire.indexOf('UPDATE public.deep_find_check_queue'), expire.indexOf('GET DIAGNOSTICS recovered'))
  expect(recovery).toContain("SET status='queued',next_at=now()")
  expect(recovery).toContain("q.status='running' AND q.claimed_at<now()-interval '5 minutes'")
  expect(recovery).toContain("now()<r.started_at+interval '60 minutes' AND r.status<>'cancelled'")
  expect(recovery).not.toContain('attempts=')
  expect(expire).toContain('RETURN recovered+expired+siblings')
})
it('includes written-only rollback audits for the rulings and the complete 074 matrix', () => {
  for (const basis of ['checker_valid','replied','sent_ok','company_site','places','saved_non_guessed','supported_pattern','evidence_mismatch','role_review','pattern_paused','weak_evidence','ms_exists','role_confirmed','ms_not_found','saved_unproven']) expect(audit).toContain(`'${basis}'`)
  for (const marker of ['R4 same person across leads', 'R5 stale running recovery', 'R9 accepted pairs', 'R9 wrong tiers', 'R9 snapshot invariants']) expect(audit).toContain(marker)
  expect(audit).toContain("RAISE EXCEPTION 'VERIFIER_V2_QUEUE_AUDIT_ROLLBACK")
})
