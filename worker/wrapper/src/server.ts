import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { scrapeSite } from './scrapeSite.js'
import { verifyEmail } from './verifyEmail.js'
import { searchWeb } from './search.js'

const secret = process.env.WRAPPER_SECRET
if (!secret || secret.length < 32) {
  console.error('WRAPPER_SECRET missing or shorter than 32 characters; refusing to start')
  process.exit(1)
}

const reacherUrl = process.env.REACHER_URL
const reacherSecret = process.env.REACHER_SECRET
const timeoutMs = process.env.VERIFY_TIMEOUT_MS === undefined ? undefined : Number(process.env.VERIFY_TIMEOUT_MS)
if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error('Invalid VERIFY_TIMEOUT_MS')
const verify = reacherUrl ? (email: string) => verifyEmail(email, { reacherUrl, reacherSecret, timeoutMs }) : undefined

const scraperUrl = process.env.SCRAPER_URL
const scraperSecret = process.env.SCRAPER_SECRET
const scrape =
  scraperUrl && scraperSecret
    ? (url: string, mode: Parameters<typeof scrapeSite>[1]) => scrapeSite(url, mode, { scraperUrl, scraperSecret })
    : undefined

const searxUrl = process.env.SEARX_URL
const search = searxUrl ? (query: string) => searchWeb(query, { searxUrl }) : undefined
serve({ fetch: buildApp(secret, { verify, scrape, search }).fetch, port: Number(process.env.PORT ?? 8080) })
console.log('lookup wrapper listening')
