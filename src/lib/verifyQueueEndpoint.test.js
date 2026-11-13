import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn(() => ({})) }))
vi.mock('../../supabase/functions/_shared/verifyQueue', () => ({ drainQueue: vi.fn() }))
vi.mock('../../supabase/functions/_shared/verifyQueueService', () => ({ createQueueDeps: vi.fn(() => ({})) }))
import { drainQueue } from '../../supabase/functions/_shared/verifyQueue'
import { createClient } from 'npm:@supabase/supabase-js@2'

let handler
beforeEach(async () => {
  vi.clearAllMocks(); vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: name => name === 'CRON_SECRET' ? 'fixture-cron' : 'local-test-placeholder' }, serve: callback => { handler = callback } })
  vi.stubGlobal('EdgeRuntime', { waitUntil: vi.fn() })
  await import('../../supabase/functions/run-verify-queue/index')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const request = (method = 'POST', secret = 'fixture-cron') => new Request('http://localhost/run-verify-queue', { method, headers: { 'x-cron-secret': secret } })
it('returns 202 before the background drain resolves', async () => {
  let release; drainQueue.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const result = handler(request())
  try {
    const response = await Promise.race([result, new Promise(resolve => setTimeout(() => resolve(null), 30))])
    expect(response?.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
    expect(EdgeRuntime.waitUntil).toHaveBeenCalledTimes(1)
    expect(drainQueue.mock.calls[0][2]).toBe(140_000)
  } finally { release({ processed: 1 }); await result }
})
it.each([['GET', 'fixture-cron', 405], ['POST', 'wrong', 403]])('retains %s refusal %i', async (method, secret, status) => {
  expect((await handler(request(method, secret))).status).toBe(status)
  expect(drainQueue).not.toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled()
})
it('awaits the guarded drain without EdgeRuntime and still returns accepted', async () => {
  vi.stubGlobal('EdgeRuntime', undefined)
  let release; drainQueue.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let responded = false; const result = handler(request()).then(response => { responded = true; return response })
  await vi.waitFor(() => expect(drainQueue).toHaveBeenCalled())
  expect(responded).toBe(false)
  release({ processed: 1 }); const response = await result
  expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true })
})
it('logs background errors safely without returning provider data', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  drainQueue.mockRejectedValue(new Error('private fixture payload'))
  const response = await handler(request()); await EdgeRuntime.waitUntil.mock.calls[0][0]
  expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true })
  expect(log).toHaveBeenCalledWith('Background check tick failed', 'Error')
})
