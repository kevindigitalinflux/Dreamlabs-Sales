import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
it('enqueues only after saved readiness with the exact approved step line', () => {
  const source = read('supabase/functions/_shared/deepFind.ts')
  expect(source.indexOf('await enqueueLeadChecks')).toBeGreaterThan(source.indexOf("if (readinessError || !savedReadiness?.length)"))
  expect(source).toContain('${queued} more addresses are being checked in the background. Results update this lead when they finish.')
})
it('wires the cron-only entrypoint into config and local edge checks', () => {
  const entry = read('supabase/functions/run-verify-queue/index.ts')
  expect(entry).toContain('cronSecretMatches')
  expect(entry.indexOf('cronSecretMatches(req.headers')).toBeLessThan(entry.indexOf('createClient(Deno.env'))
  expect(entry).toContain('140_000')
  expect(read('supabase/config.toml')).toMatch(/\[functions.run-verify-queue\]\s*verify_jwt = false/)
  expect(read('scripts/places-edge-typecheck.mjs')).toContain("'run-verify-queue'")
})
