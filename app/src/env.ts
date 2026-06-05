import { z } from 'zod'

export const envSchema = z.object({
  REALTIME_API_URL: z.url().default('http://127.0.0.1:8791'),
  FISH_VOICE_ID: z.string().min(1).optional(),
  FISH_TTS_MODEL: z.enum(['s1', 's2-pro']).optional(),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(69_69),
  COMMIT_SHA: z.string().optional()
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(env: Partial<Cloudflare.Env> = {}): AppEnv {
  return envSchema.parse({ ...process.env, ...env })
}
