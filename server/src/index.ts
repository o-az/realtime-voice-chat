import { z } from 'zod'
import * as Bun from 'bun'
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk'

const AGENT_NAME = 'fish-voice-agent'
const voiceIdSchema = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{8,80}$/)
    .optional()
)

const envSchema = z.object({
  LIVEKIT_URL: z.url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  FISH_API_KEY: z.string().min(1),
  FISH_VOICE_ID: z.string().min(1),
  FISH_TTS_MODEL: z.enum(['s1', 's2-pro']).default('s2-pro'),
  PORT: z.coerce.number().int().positive().default(8787)
})

const env = envSchema.parse(Bun.env)

const tokenRequestSchema = z.object({
  room: z.string().trim().min(1).max(64).default('fish-voice-demo'),
  voiceId: voiceIdSchema.optional(),
  identity: z.string().trim().min(1).max(64).optional()
})

const headers = new Headers({
  'X-Request-Id': Bun.randomUUIDv7(),
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
})

// TODO: actually handle errors not just lazy catch
async function fishJson(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`https://api.fish.audio${path}`, {
    headers: { Authorization: `Bearer ${env.FISH_API_KEY}` }
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

async function checkFishVoice(voiceId: string) {
  const [credit, plan, voice] = await Promise.all([
    fishJson('/wallet/self/api-credit?check_free_credit=true'),
    fishJson('/wallet/self/package'),
    fishJson(`/model/${voiceId}`)
  ])

  const ttsProbe = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FISH_API_KEY}`,
      'Content-Type': 'application/json',
      model: env.FISH_TTS_MODEL
    },
    body: JSON.stringify({
      text: 'test',
      reference_id: voiceId,
      format: 'mp3'
    })
  })
  const ttsBody = await ttsProbe.json().catch(() => null)

  return {
    ok: credit.status === 200 && voice.status === 200 && ttsProbe.ok,
    credit: {
      status: credit.status,
      credit: credit.body?.credit,
      hasFreeCredit: credit.body?.has_free_credit
    },
    plan: {
      status: plan.status,
      type: plan.body?.type,
      balance: plan.body?.balance,
      extraBalance: plan.body?.extra_balance,
      finishedAt: plan.body?.finished_at
    },
    voice: {
      status: voice.status,
      id: voice.body?._id,
      title: voice.body?.title,
      state: voice.body?.state,
      visibility: voice.body?.visibility
    },
    tts: {
      status: ttsProbe.status,
      message: ttsBody ? JSON.stringify(ttsBody, undefined, 2) : null
    }
  }
}

const server = Bun.serve({
  port: env.PORT,
  fetch: async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
    return new Response()
  },
  routes: {
    '/health': async (request, server) => {
      const ip = server.requestIP(request)
      const result = { ok: true, rev: Bun.env.COMMIT_SHA }

      if (!ip) return Response.json(result, { headers })

      return Response.json(
        { ...result, ip: { port: ip.port, family: ip.family, address: ip.address } },
        { headers }
      )
    },
    '/config': async request => {
      if (request.method !== 'GET')
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
      return Response.json({ defaultFishVoiceId: env.FISH_VOICE_ID }, { headers })
    },
    '/fish/preflight': async request => {
      if (request.method !== 'GET')
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers })

      const url = new URL(request.url)
      const voiceId = voiceIdSchema.parse(url.searchParams.get('voiceId')) ?? env.FISH_VOICE_ID
      const result = await checkFishVoice(voiceId)
      return Response.json(result, { headers })
    },
    '/token': async request => {
      if (request.method !== 'POST')
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers })

      const parsedBody = await request.json()
      const body = tokenRequestSchema.parse(parsedBody)

      const voiceId = body.voiceId ?? env.FISH_VOICE_ID
      const fish = await checkFishVoice(voiceId)
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

      return Response.json({
        voiceId,
        identity,
        room: body.room,
        url: env.LIVEKIT_URL,
        token: await token.toJwt()
      })
    }
  },
  error: error => {
    console.error('unhandled_server_error', {
      error: error instanceof Error ? error.message : String(error)
    })
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(errorMessage, { status: 500, headers })
  }
})

if (Bun.env.NODE_ENV === 'development')
  console.info('server_started', {
    url: server.url.toString().replaceAll(`${server.port}/`, `${server.port}`)
  })
else console.info('info', 'server_started', { port: server.port })
