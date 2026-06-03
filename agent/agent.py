import json
import logging
import os
from typing import Literal, cast

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions
from livekit.agents.llm import LLM
from livekit.agents.stt import STT
from livekit.plugins import fishaudio, openai, silero, xai
from livekit.plugins.fishaudio.models import LatencyMode
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv("../.env")

logger = logging.getLogger("fish-voice-agent")


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are a concise realtime voice assistant. Keep replies short, "
                "natural, and easy to interrupt. Do not use complex formatting, "
                "emojis, or long lists unless the user asks. In voice chat, answer "
                "with one short complete sentence by default."
            )
        )


server = AgentServer()


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


def fish_latency_mode() -> LatencyMode:
    value = os.getenv("FISH_TTS_LATENCY_MODE", "low")
    if value not in {"normal", "balanced", "low"}:
        raise ValueError(f"Unsupported FISH_TTS_LATENCY_MODE: {value}")
    return cast(LatencyMode, value)


def interruption_mode() -> Literal["vad", "adaptive"]:
    value = os.getenv("INTERRUPTION_MODE", "vad")
    if value not in {"vad", "adaptive"}:
        raise ValueError(f"Unsupported INTERRUPTION_MODE: {value}")
    return cast(Literal["vad", "adaptive"], value)


def build_stt() -> STT:
    provider = os.getenv("STT_PROVIDER", "xai").lower()

    if provider == "xai":
        language = os.getenv("XAI_STT_LANGUAGE", "en")
        endpointing = int(os.getenv("XAI_STT_ENDPOINTING_MS", "100"))
        logger.info(
            "using STT provider=xai language=%s endpointing_ms=%s interim_results=true",
            language,
            endpointing,
        )
        return xai.STT(
            api_key=require_env("XAI_API_KEY"),
            language=language,
            endpointing=endpointing,
            enable_interim_results=True,
        )

    if provider == "openai":
        model = os.getenv("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe")
        logger.info("using STT provider=openai model=%s", model)
        return openai.STT(model=model)

    raise ValueError(f"Unsupported STT_PROVIDER: {provider}")


def build_llm() -> LLM:
    provider = os.getenv("LLM_PROVIDER", "xai").lower()

    if provider == "xai":
        model = os.getenv("XAI_LLM_MODEL", "grok-4.3")
        logger.info("using LLM provider=xai model=%s base_url=https://api.x.ai/v1", model)
        return openai.LLM(
            api_key=require_env("XAI_API_KEY"),
            base_url="https://api.x.ai/v1",
            model=model,
        )

    if provider == "openai":
        model = require_env("OPENAI_LLM_MODEL")
        logger.info("using LLM provider=openai model=%s", model)
        return openai.LLM(model=model)

    raise ValueError(f"Unsupported LLM_PROVIDER: {provider}")


def fish_voice_id(ctx: agents.JobContext) -> str:
    fallback = require_env("FISH_VOICE_ID")
    metadata = ctx.job.metadata
    if not metadata:
        return fallback

    try:
        parsed = json.loads(metadata)
    except json.JSONDecodeError:
        logger.warning("ignoring invalid job metadata: %s", metadata)
        return fallback

    voice_id = parsed.get("fishVoiceId")
    if isinstance(voice_id, str) and voice_id:
        return voice_id

    return fallback


@server.rtc_session(agent_name="fish-voice-agent")
async def fish_voice_agent(ctx: agents.JobContext) -> None:
    voice_id = fish_voice_id(ctx)
    fish_tts_model = os.getenv("FISH_TTS_MODEL", "s2-pro")
    fish_tts_latency_mode = fish_latency_mode()
    fish_tts_chunk_length = int(os.getenv("FISH_TTS_CHUNK_LENGTH", "100"))
    endpointing_min_delay = float(os.getenv("ENDPOINTING_MIN_DELAY_SECONDS", "0.25"))
    endpointing_max_delay = float(os.getenv("ENDPOINTING_MAX_DELAY_SECONDS", "1.5"))
    preemptive_tts = os.getenv("PREEMPTIVE_TTS", "true").lower() == "true"
    selected_interruption_mode = interruption_mode()

    logger.info(
        "using TTS provider=fish model=%s voice_id=%s latency_mode=%s chunk_length=%s",
        fish_tts_model,
        voice_id,
        fish_tts_latency_mode,
        fish_tts_chunk_length,
    )
    logger.info(
        "using turn handling endpointing_min_delay=%s endpointing_max_delay=%s "
        "preemptive_tts=%s interruption_mode=%s",
        endpointing_min_delay,
        endpointing_max_delay,
        preemptive_tts,
        selected_interruption_mode,
    )

    session = AgentSession(
        stt=build_stt(),
        llm=build_llm(),
        tts=fishaudio.TTS(
            voice_id=voice_id,
            model=fish_tts_model,
            latency_mode=fish_tts_latency_mode,
            chunk_length=fish_tts_chunk_length,
        ),
        aec_warmup_duration=float(os.getenv("AEC_WARMUP_SECONDS", "1.0")),
        vad=silero.VAD.load(),
        turn_handling=TurnHandlingOptions(
            turn_detection=MultilingualModel(),
            endpointing={
                "min_delay": endpointing_min_delay,
                "max_delay": endpointing_max_delay,
            },
            interruption={
                "mode": selected_interruption_mode,
                "min_duration": float(os.getenv("INTERRUPTION_MIN_DURATION_SECONDS", "0.25")),
                "backchannel_boundary": None,
            },
            preemptive_generation={
                "enabled": True,
                "preemptive_tts": preemptive_tts,
            },
        ),
    )

    @session.on("agent_state_changed")
    def on_agent_state_changed(event: agents.AgentStateChangedEvent) -> None:
        logger.info("agent state changed: %s -> %s", event.old_state, event.new_state)

    @session.on("user_state_changed")
    def on_user_state_changed(event: agents.UserStateChangedEvent) -> None:
        logger.info("user state changed: %s -> %s", event.old_state, event.new_state)

    @session.on("overlapping_speech")
    def on_overlapping_speech(event: object) -> None:
        logger.info("overlapping speech detected: %s", event)

    @session.on("agent_false_interruption")
    def on_agent_false_interruption(event: object) -> None:
        logger.info("false interruption detected: %s", event)

    await session.start(room=ctx.room, agent=Assistant())
    await session.generate_reply(instructions="Greet the user briefly and invite them to speak.")


if __name__ == "__main__":
    agents.cli.run_app(server)
