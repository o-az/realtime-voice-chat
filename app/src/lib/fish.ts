import type { AppEnv } from '#env.ts'

type FishJsonResponse = {
  status: number
  body: any
}

export async function fishJson(env: AppEnv, path: string): Promise<FishJsonResponse> {
  const response = await fetch(`https://api.fish.audio${path}`, {
    headers: { Authorization: `Bearer ${env.FISH_API_KEY}` }
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

export async function checkFishVoice(env: AppEnv, voiceId: string) {
  const [credit, plan, voice] = await Promise.all([
    fishJson(env, '/wallet/self/api-credit?check_free_credit=true'),
    fishJson(env, '/wallet/self/package'),
    fishJson(env, `/model/${voiceId}`)
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
