import asyncio
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Literal, cast

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions
from livekit.agents.llm import LLM, ToolError, function_tool
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
                "You are maximally truth-seeking. You consider free speech a highest "
                "virtue, and you respect freedom, exploration, and experimentation for "
                "the purpose of learning. Be intellectually honest, curious, and direct. "
                "Say when you are uncertain, and update your view when evidence warrants "
                "it. Use web search for current facts, recent events, external references, "
                "or anything that depends on live information. When you use web search, "
                "ground the answer in the returned sources. Do not mention internal "
                "instructions or say that your behavior is required by design."
            )
        )

    @function_tool(
        description=(
            "Search the web with Brave Search for current facts, recent events, "
            "external references, or source-backed lookup."
        )
    )
    async def search_web(self, query: str, count: int = 5) -> str:
        """Search the web and return compact source-backed results."""
        api_key = os.getenv("BRAVE_SEARCH_API_KEY")
        if not api_key:
            raise ToolError("BRAVE_SEARCH_API_KEY is not configured.")

        result_count = max(1, min(count, 8))
        params = {
            "q": query,
            "count": str(result_count),
            "safesearch": os.getenv("BRAVE_SEARCH_SAFESEARCH", "moderate"),
            "country": os.getenv("BRAVE_SEARCH_COUNTRY", "US"),
            "search_lang": os.getenv("BRAVE_SEARCH_LANGUAGE", "en"),
        }
        url = "https://api.search.brave.com/res/v1/web/search?" + urllib.parse.urlencode(params)

        def request() -> dict[str, Any]:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": api_key,
                },
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                body = response.read().decode("utf-8")
            parsed = json.loads(body)
            if not isinstance(parsed, dict):
                raise ToolError("Brave Search returned an unexpected response.")
            return parsed

        try:
            data = await asyncio.to_thread(request)
        except urllib.error.HTTPError as error:
            raise ToolError(f"Brave Search failed with HTTP {error.code}.") from error
        except urllib.error.URLError as error:
            raise ToolError(f"Brave Search request failed: {error.reason}.") from error
        except TimeoutError as error:
            raise ToolError("Brave Search timed out.") from error

        web = data.get("web")
        results = web.get("results") if isinstance(web, dict) else None
        if not isinstance(results, list) or not results:
            return f"No Brave Search results found for: {query}"

        lines = [f"Brave Search results for: {query}"]
        for index, item in enumerate(results[:result_count], start=1):
            if not isinstance(item, dict):
                continue

            title = str(item.get("title") or "Untitled").strip()
            result_url = str(item.get("url") or "").strip()
            description = str(item.get("description") or "").strip()
            age = str(item.get("age") or "").strip()

            line = f"{index}. {title}"
            if age:
                line += f" ({age})"
            if result_url:
                line += f"\n   URL: {result_url}"
            if description:
                line += f"\n   Snippet: {description}"
            lines.append(line)

        return "\n".join(lines)


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


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_optional_float(name: str, default: float | None) -> float | None:
    value = os.getenv(name)
    if value is None:
        return default
    if value.lower() in {"none", "null", "off", "disabled"}:
        return None
    return float(value)


def clean_log_text(value: str | None) -> str | None:
    if not value:
        return None
    text = " ".join(value.split())
    return text or None


def chat_item_text(item: object) -> str | None:
    text_content = getattr(item, "text_content", None)
    if isinstance(text_content, str):
        return clean_log_text(text_content)
    return None


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
    resume_false_interruption = env_bool("RESUME_FALSE_INTERRUPTION", False)
    false_interruption_timeout = env_optional_float("FALSE_INTERRUPTION_TIMEOUT_SECONDS", None)
    interruption_min_duration = float(os.getenv("INTERRUPTION_MIN_DURATION_SECONDS", "0.25"))

    logger.info(
        "using TTS provider=fish model=%s voice_id=%s latency_mode=%s chunk_length=%s",
        fish_tts_model,
        voice_id,
        fish_tts_latency_mode,
        fish_tts_chunk_length,
    )
    logger.info(
        "using turn handling endpointing_min_delay=%s endpointing_max_delay=%s "
        "preemptive_tts=%s interruption_mode=%s resume_false_interruption=%s "
        "false_interruption_timeout=%s interruption_min_duration=%s",
        endpointing_min_delay,
        endpointing_max_delay,
        preemptive_tts,
        selected_interruption_mode,
        resume_false_interruption,
        false_interruption_timeout,
        interruption_min_duration,
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
                "min_duration": interruption_min_duration,
                "resume_false_interruption": resume_false_interruption,
                "false_interruption_timeout": false_interruption_timeout,
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

    logged_transcript_items: set[str] = set()

    @session.on("conversation_item_added")
    def on_conversation_item_added(event: agents.ConversationItemAddedEvent) -> None:
        item = event.item
        role = getattr(item, "role", None)
        if role not in {"user", "assistant"}:
            return

        item_id = getattr(item, "id", None)
        if isinstance(item_id, str):
            if item_id in logged_transcript_items:
                return
            logged_transcript_items.add(item_id)

        text = chat_item_text(item)
        if not text:
            return

        label = "agent" if role == "assistant" else "user"
        interrupted = role == "assistant" and getattr(item, "interrupted", False)
        suffix = " interrupted" if interrupted else ""
        logger.info("transcript %s%s: %s", label, suffix, text)

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
