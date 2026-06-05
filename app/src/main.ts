import * as z from 'zod'
import { Hono } from 'hono'
import { ulid } from '@std/ulid'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { initLogger, log } from 'evlog'
import { requestId } from 'hono/request-id'
import { prettyJSON } from 'hono/pretty-json'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk'

import { parseEnv } from '#env.ts'
import { checkFishVoice } from '#fish.ts'

initLogger({
  env: {
    service: 'fish-voice-app',
    environment: process.env.NODE_ENV ?? 'development'
  },
  pretty: false
})

const AGENT_NAME = 'fish-voice-agent'
// O: extreme over engineering
const voiceIdSchema = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{8,80}$/)
    .optional()
)

const tokenRequestSchema = z.object({
  room: z.string().trim().min(1).max(64).default('fish-voice-demo'),
  voiceId: voiceIdSchema.optional(),
  identity: z.string().trim().min(1).max(64).optional()
})

const startRequestSchema = z.object({
  fishVoiceId: voiceIdSchema.optional(),
  fishModelId: z.string().trim().min(1).max(64).optional()
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
  return context.json({ defaultFishVoiceId: env.FISH_VOICE_ID })
})

app.get('/api/fish/preflight', async context => {
  const env = parseEnv(context.env)
  const voiceId = voiceIdSchema.parse(context.req.query('voiceId')) ?? env.FISH_VOICE_ID
  /**
   * O: this has a promise array inside it that calls an external API multiple times and with 0
   * runtime response validation or proper error handling
   */
  const result = await checkFishVoice(env, voiceId)
  context.get('log').set({ route: '/api/fish/preflight', voiceId, ok: result.ok })
  return context.json(result)
})

// O: introduce some spacing between logical groups of LoCs. Otherwise hard to read
app.post('/api/start', async context => {
  const env = parseEnv(context.env)
  // O: terrible. Read the repo's AGENTS.md please
  const parsedBody = await context.req.json().catch(() => ({}))
  const body = startRequestSchema.parse(parsedBody)
  const fishVoiceId = body.fishVoiceId ?? env.FISH_VOICE_ID
  const fish = await checkFishVoice(env, fishVoiceId)
  if (!fish.ok) {
    const detail = fish.tts.message
      ? `Fish TTS ${fish.tts.status}: ${fish.tts.message}`
      : 'Fish preflight failed'
    throw new Error(detail)
  }

  const realtimeUrl = new URL('/v1/start', env.REALTIME_API_URL)
  const response = await fetch(realtimeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fish_voice_id: fishVoiceId,
      fish_model_id: body.fishModelId ?? env.FISH_TTS_MODEL
    }),
    signal: AbortSignal.timeout(12_000)
  })

  // O: terrible. Read the repo's AGENTS.md please
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? String(payload.detail)
        : `Realtime service returned ${response.status}`
    context.get('log').set({ route: '/api/start', fishVoiceId, error: detail })
    return context.json({ error: detail }, response.status as 400 | 401 | 500 | 502 | 503)
  }

  context.get('log').set({ route: '/api/start', fishVoiceId })
  log.info({ action: 'daily_session_started', fishVoiceId, realtimeUrl: env.REALTIME_API_URL })

  return context.json(payload)
})

app.post('/api/token', async context => {
  const env = parseEnv(context.env)
  const parsedBody = await context.req.json()
  const body = tokenRequestSchema.parse(parsedBody)

  const voiceId = body.voiceId ?? env.FISH_VOICE_ID
  const fish = await checkFishVoice(env, voiceId)
  if (!fish.ok) {
    const detail = fish.tts.message
      ? `Fish TTS ${fish.tts.status}: ${fish.tts.message}`
      : 'Fish preflight failed'
    throw new Error(detail)
  }

  const identity = body.identity ?? `browser-${ulid()}`
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: '10m'
  })

  token.addGrant({
    room: body.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true
  })

  token.roomConfig = new RoomConfiguration({
    name: body.room,
    agents: [
      new RoomAgentDispatch({
        agentName: AGENT_NAME,
        metadata: JSON.stringify({ fishVoiceId: voiceId })
      })
    ]
  })

  context.get('log').set({ route: '/api/token', room: body.room, identity, voiceId })
  log.info({ action: 'token_issued', room: body.room, identity, voiceId })

  return context.json({
    voiceId,
    identity,
    room: body.room,
    url: env.LIVEKIT_URL,
    token: await token.toJwt()
  })
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
