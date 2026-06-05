import * as z from 'zod'
import { Hono } from 'hono'
import { ulid } from '@std/ulid'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { initLogger, log } from 'evlog'
import { requestId } from 'hono/request-id'
import { prettyJSON } from 'hono/pretty-json'
import { evlog, type EvlogVariables } from 'evlog/hono'

import { parseEnv } from '#env.ts'

initLogger({
  env: {
    service: 'fish-voice-app',
    environment: process.env.NODE_ENV ?? 'development'
  },
  pretty: false
})

const voiceIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{8,80}$/)

const startRequestSchema = z.object({
  fishVoiceId: voiceIdSchema.optional(),
  fishModelId: z.string().trim().min(1).max(64).optional()
})

const realtimeStartResponseSchema = z.object({
  session_id: z.string(),
  url: z.string().url(),
  token: z.string(),
  room_url: z.string().url(),
  fish_voice_id: z.string(),
  provider: z.string()
})

const realtimeErrorSchema = z.object({
  detail: z.string().optional(),
  error: z.string().optional()
})

export const app = new Hono<{ Bindings: Cloudflare.Env } & EvlogVariables>()
  .use(evlog())
  .use(prettyJSON())
  .use('*', timeout(15_000))
  .use(
    requestId({
      headerName: 'X-Request-Id',
      /**
       * !!!!!!!!!!!!!!! DO NOT !!!!!!!!!!!!!!!
       *
       * Remove this and replace it with crypto.randomUUID()
       */
      generator: () => ulid()
    })
  )
  .get('/.well-known/appspecific/com.chrome.devtools.json', context => context.text('N/A'))

app.get('/health', async context => {
  const env = parseEnv(context.env)
  context.get('log').set({ route: '/health' })
  return context.json({ ok: true, rev: env.COMMIT_SHA })
})

app.get('/api/config', async context => {
  const env = parseEnv(context.env)
  context.get('log').set({ route: '/api/config' })
  return context.json({ defaultFishVoiceId: env.FISH_VOICE_ID ?? '' })
})

app.post('/api/start', async context => {
  const env = parseEnv(context.env)
  const body = startRequestSchema.parse(await context.req.json())
  const fishVoiceId = body.fishVoiceId ?? env.FISH_VOICE_ID

  const realtimeUrl = new URL('/v1/start', env.REALTIME_API_URL)
  const realtimeBody: Record<string, string> = {}
  const fishModelId = body.fishModelId ?? env.FISH_TTS_MODEL
  if (fishVoiceId) realtimeBody.fish_voice_id = fishVoiceId
  if (fishModelId) realtimeBody.fish_model_id = fishModelId

  const response = await fetch(realtimeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(realtimeBody),
    signal: AbortSignal.timeout(12_000)
  })

  const payload: unknown = await response.json()

  if (!response.ok) {
    const parsedError = realtimeErrorSchema.safeParse(payload)
    const detail = parsedError.success
      ? (parsedError.data.detail ??
        parsedError.data.error ??
        `Realtime service returned ${response.status}`)
      : `Realtime service returned ${response.status}`

    context.get('log').set({ route: '/api/start', fishVoiceId, error: detail })
    return context.json({ error: detail }, response.status as 400 | 401 | 500 | 502 | 503)
  }

  const start = realtimeStartResponseSchema.parse(payload)
  context.get('log').set({ route: '/api/start', fishVoiceId })
  log.info({ action: 'daily_session_started', fishVoiceId, realtimeUrl: env.REALTIME_API_URL })

  return context.json(start)
})

app.notFound(context => {
  if (context.req.path.startsWith('/api/')) return context.json({ error: 'Not found' }, 404)
  return context.redirect('/')
})

app.onError((error, context) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  context.get('log').set({ error: errorMessage })
  log.error({ action: 'request_failed', path: context.req.path, error: errorMessage })
  return context.json({ error: errorMessage }, 400)
})

if (process.env.NODE_ENV === 'development') showRoutes(app)

export default app satisfies ExportedHandler<Cloudflare.Env>
