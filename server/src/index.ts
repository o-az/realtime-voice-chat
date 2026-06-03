import cors from "cors";
import express from "express";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration
} from "livekit-server-sdk";
import { z } from "zod";

const AGENT_NAME = "fish-voice-agent";

const envSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  FISH_API_KEY: z.string().min(1),
  FISH_VOICE_ID: z.string().min(1),
  FISH_TTS_MODEL: z.enum(["s1", "s2-pro"]).default("s2-pro"),
  PORT: z.coerce.number().int().positive().default(8787)
});

const env = envSchema.parse(process.env);
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

const tokenRequestSchema = z.object({
  room: z.string().trim().min(1).max(64).default("fish-voice-demo"),
  identity: z.string().trim().min(1).max(64).optional()
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

async function fishJson(path: string) {
  const response = await fetch(`https://api.fish.audio${path}`, {
    headers: {
      Authorization: `Bearer ${env.FISH_API_KEY}`
    }
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

app.get("/fish/preflight", async (_req, res, next) => {
  try {
    const [credit, plan, voice] = await Promise.all([
      fishJson("/wallet/self/api-credit?check_free_credit=true"),
      fishJson("/wallet/self/package"),
      fishJson(`/model/${env.FISH_VOICE_ID}`)
    ]);

    const ttsProbe = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FISH_API_KEY}`,
        "Content-Type": "application/json",
        model: env.FISH_TTS_MODEL
      },
      body: JSON.stringify({
        text: "test",
        reference_id: env.FISH_VOICE_ID,
        format: "mp3"
      })
    });
    const ttsBody = await ttsProbe.json().catch(() => null);

    res.json({
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
        message: ttsBody?.message ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/token", async (req, res, next) => {
  try {
    const body = tokenRequestSchema.parse(req.body ?? {});
    const identity =
      body.identity ?? `browser-${crypto.randomUUID().slice(0, 8)}`;

    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      ttl: "10m"
    });

    token.addGrant({
      room: body.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true
    });

    token.roomConfig = new RoomConfiguration({
      name: body.room,
      agents: [
        new RoomAgentDispatch({
          agentName: AGENT_NAME
        })
      ]
    });

    res.json({
      identity,
      room: body.room,
      token: await token.toJwt(),
      url: env.LIVEKIT_URL
    });
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
);

app.listen(env.PORT, () => {
  console.log(`token server listening on http://localhost:${env.PORT}`);
});
