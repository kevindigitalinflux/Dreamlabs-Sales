import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { verifyEmail } from './verifyEmail.js'

const secret = process.env.WRAPPER_SECRET
if (!secret || secret.length < 32) {
  console.error('WRAPPER_SECRET missing or shorter than 32 characters; refusing to start')
  process.exit(1)
}

const reacherUrl = process.env.REACHER_URL
const reacherSecret = process.env.REACHER_SECRET
const verify = reacherUrl ? (email: string) => verifyEmail(email, { reacherUrl, reacherSecret }) : undefined

serve({ fetch: buildApp(secret, { verify }).fetch, port: Number(process.env.PORT ?? 8080) })
console.log('lookup wrapper listening')
