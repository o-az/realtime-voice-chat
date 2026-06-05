interface EnvironmentVariables {
  readonly PORT: string
  readonly ENVIRONMENT: 'development' | 'production' | 'test'
  readonly COMMIT_SHA: string
  readonly LIVEKIT_URL: string
  readonly LIVEKIT_API_KEY: string
  readonly LIVEKIT_API_SECRET: string

  readonly FISH_API_KEY: string
  readonly FISH_VOICE_ID: string

  readonly OPENAI_API_KEY: string
  readonly XAI_API_KEY: string
  readonly BRAVE_SEARCH_API_KEY: string

  readonly STT_PROVIDER: 'xai' | 'openai' | 'brave_search'
  readonly XAI_STT_LANGUAGE: string
  readonly XAI_STT_ENDPOINTING_MS: string

  readonly LLM_PROVIDER: 'xai' | 'openai'
  readonly XAI_LLM_MODEL: string
  readonly OPENAI_LLM_MODEL: string
  readonly BRAVE_SEARCH_COUNTRY: string
  readonly BRAVE_SEARCH_LANGUAGE: string
  readonly BRAVE_SEARCH_SAFESEARCH: 'off' | 'moderate' | 'strict'

  readonly TTS_PROVIDER: 'fish' | 'miso'
  readonly FISH_TTS_MODEL: string

  readonly FISH_TTS_LATENCY_MODE: 'low' | 'medium' | 'high'
  readonly FISH_TTS_CHUNK_LENGTH: string
  readonly MISO_TTS_URL: string
  readonly MISO_TTS_MODEL: string
  readonly MISO_TTS_DEVICE: string
  readonly MISO_TTS_DTYPE: 'auto' | 'float16' | 'fp16' | 'bfloat16' | 'bf16' | 'float32' | 'fp32'
  readonly MISO_TTS_SPEAKER: string
  readonly MISO_TTS_SAMPLE_RATE: string
  readonly MISO_TTS_MAX_AUDIO_LENGTH_MS: string
  readonly MISO_TTS_TIMEOUT_SECONDS: string
  readonly MISO_TTS_TEMPERATURE: string
  readonly MISO_TTS_TOPK: string

  readonly ENDPOINTING_MIN_DELAY_SECONDS: string
  readonly ENDPOINTING_MAX_DELAY_SECONDS: string
  readonly PREEMPTIVE_TTS: 'true' | 'false'
  readonly AEC_WARMUP_SECONDS: string
  readonly INTERRUPTION_MODE: 'vad' | 'fixed'
  readonly INTERRUPTION_MIN_DURATION_SECONDS: string
  readonly RESUME_FALSE_INTERRUPTION: 'true' | 'false'
  readonly FALSE_INTERRUPTION_TIMEOUT_SECONDS: string
}

// Node.js `process.env` auto-completion
declare namespace NodeJS {
  interface ProcessEnv extends EnvironmentVariables {
    readonly NODE_ENV: EnvironmentVariables['ENVIRONMENT']
  }
}

// Bun `Bun.env` auto-completion
declare namespace Bun {
  interface Env extends EnvironmentVariables {
    readonly NODE_ENV: EnvironmentVariables['ENVIRONMENT']
  }
}

// Bun/vite `import.meta.env` auto-completion
interface ImportMetaEnv extends EnvironmentVariables {
  readonly MODE: EnvironmentVariables['ENVIRONMENT']
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
