import { serve } from '@hono/node-server'
import { buildApp } from './app.js'

const secret = process.env.WRAPPER_SECRET
if (!secret || secret.length < 32) {
  console.error('WRAPPER_SECRET missing or shorter than 32 characters; refusing to start')
  process.exit(1)
}

serve({ fetch: buildApp(secret).fetch, port: Number(process.env.PORT ?? 8080) })
console.log('lookup wrapper listening')
