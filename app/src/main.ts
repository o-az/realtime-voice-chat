import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { ulid } from '@std/ulid'
import { initLogger } from 'evlog'
import { proxy } from 'hono/proxy'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { requestId } from 'hono/request-id'
import { prettyJSON } from 'hono/pretty-json'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { stream, streamText, streamSSE } from 'hono/streaming'

import { landingApp } from '#app.tsx'

initLogger({
  env: {
    service: 'fish-voice-app',
    environment: process.env.NODE_ENV ?? 'development'
  },
  pretty: true
})

export const app = new Hono<{ Bindings: Cloudflare.Env } & EvlogVariables>()
  .use(evlog())
  .use(prettyJSON())
  .use('*', timeout(5_000))
  .use(
    requestId({
      headerName: 'X-H0N0-Request-ID',
      generator: () => ulid()
    })
  )

app.get('/health', async context => {
  context.get('log').set({ route: '/health' })
  return context.json({ ok: true, rev: context.env.COMMIT_SHA })
})

app.get('/config', async context => {
  // ...
})

app.get('/fish/preflight', async context => {
  // ...
})

app.get('/token', async context => {
  // ...
})

app.route('/', landingApp)

if (process.env.NODE_ENV === 'development') showRoutes(app)

export default app satisfies ExportedHandler<Cloudflare.Env>
