import { z } from 'zod'

export const envSchema = z.object({
  LIVEKIT_URL: z.url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  FISH_API_KEY: z.string().min(1),
  FISH_VOICE_ID: z.string().min(1),
  FISH_TTS_MODEL: z.enum(['s1', 's2-pro']).default('s2-pro'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(69_69),
  COMMIT_SHA: z.string().optional()
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(env: Partial<Cloudflare.Env> = {}): AppEnv {
  return envSchema.parse({ ...process.env, ...env })
}
