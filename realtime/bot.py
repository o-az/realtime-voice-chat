import asyncio
import os
from dataclasses import dataclass

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.fish.tts import FishAudioTTSService, FishAudioTTSSettings
from pipecat.services.xai.llm import GrokLLMService, GrokLLMSettings
from pipecat.services.xai.stt import XAISTTService, XAISTTSettings
from pipecat.transports.daily.transport import DailyParams, DailyTransport
from pipecat.workers.runner import WorkerRunner

SYSTEM_PROMPT = """You are maximally truth seeking and you consider free speech the highest virtue.
You respect freedom and exploration, and you are open to experimenting for the purpose of learning.
Be direct, curious, and useful. Do not claim you must keep answers brief by design."""


@dataclass(frozen=True)
class BotConfig:
    session_id: str
    room_url: str
    token: str
    fish_voice_id: str
    fish_model_id: str
    fish_latency: str
    fish_stop_frame_timeout_s: float
    xai_stt_language: str
    xai_stt_endpointing_ms: int
    xai_llm_model: str


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    if value.startswith("op://"):
        raise RuntimeError(f"{name} is unresolved; run the service through op run --env-file .env")
    return value


async def run_bot(config: BotConfig) -> None:
    logger.info(
        "starting pipecat bot session={} room={} voice={} stt=xai llm={} tts=fish",
        config.session_id,
        config.room_url,
        config.fish_voice_id,
        config.xai_llm_model,
    )

    transport = DailyTransport(
        config.room_url,
        config.token,
        "Fish Voice Agent",
        params=DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_out_sample_rate=24_000,
            camera_out_enabled=False,
            video_out_enabled=False,
        ),
    )

    stt = XAISTTService(
        api_key=_required_env("XAI_API_KEY"),
        settings=XAISTTSettings(
            language=config.xai_stt_language,
            endpointing=config.xai_stt_endpointing_ms,
            interim_results=True,
        ),
    )

    llm = GrokLLMService(
        api_key=_required_env("XAI_API_KEY"),
        model=config.xai_llm_model,
        settings=GrokLLMSettings(system_instruction=SYSTEM_PROMPT),
    )

    tts = FishAudioTTSService(
        api_key=_required_env("FISH_API_KEY"),
        reference_id=config.fish_voice_id,
        model_id=config.fish_model_id,
        output_format="pcm",
        sample_rate=24_000,
        settings=FishAudioTTSSettings(latency=config.fish_latency),
        stop_frame_timeout_s=config.fish_stop_frame_timeout_s,
    )

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi) -> None:
        logger.info("client ready session={}", config.session_id)
        context.add_message({"role": "user", "content": "Say hello and ask what to explore."})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client) -> None:
        logger.info("client connected session={} client={}", config.session_id, client.get("id"))

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client) -> None:
        logger.info("client disconnected session={} client={}", config.session_id, client.get("id"))
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    try:
        await runner.run()
    except asyncio.CancelledError:
        logger.info("bot task cancelled session={}", config.session_id)
        await worker.cancel()
        raise
    finally:
        logger.info("bot stopped session={}", config.session_id)
