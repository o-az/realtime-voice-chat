import { Hono } from 'hono'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { requestId } from 'hono/request-id'
import { prettyJSON } from 'hono/pretty-json'
import { z } from 'zod'
import { initLogger, log } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk'

import { parseEnv } from '#env.ts'
import { landingApp } from '#app.tsx'
import { checkFishVoice } from '#lib/fish.ts'

initLogger({
  env: {
    service: 'fish-voice-app',
    environment: process.env.NODE_ENV ?? 'development'
  },
  pretty: false
})

const AGENT_NAME = 'fish-voice-agent'
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

export const app = new Hono<{ Bindings: Cloudflare.Env } & EvlogVariables>()
  .use(evlog())
  .use(prettyJSON())
  .use('*', timeout(5_000))
  .use(
    requestId({
      headerName: 'X-Request-Id',
      generator: () => crypto.randomUUID()
    })
  )

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
  const result = await checkFishVoice(env, voiceId)
  context.get('log').set({ route: '/api/fish/preflight', voiceId, ok: result.ok })
  return context.json(result)
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

  const identity = body.identity ?? `browser-${crypto.randomUUID().slice(0, 8)}`
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

app.route('/', landingApp)

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
