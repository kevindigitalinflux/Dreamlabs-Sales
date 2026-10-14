import { Hono } from 'hono'
import { secretMatches } from './auth.js'

export function buildApp(secret: string | undefined) {
  const app = new Hono()

  // Every route except the 404 fallback needs the secret header.
  app.use('*', async (c, next) => {
    if (!secretMatches(secret, c.req.header('x-worker-secret'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
