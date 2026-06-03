import logging
import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions
from livekit.plugins import fishaudio, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv("../.env")

logger = logging.getLogger("fish-voice-agent")


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are a concise realtime voice assistant. Keep replies short, "
                "natural, and easy to interrupt. Do not use complex formatting, "
                "emojis, or long lists unless the user asks."
            )
        )


server = AgentServer()


@server.rtc_session(agent_name="fish-voice-agent")
async def fish_voice_agent(ctx: agents.JobContext) -> None:
    voice_id = os.getenv("FISH_VOICE_ID")
    if not voice_id:
        raise ValueError("FISH_VOICE_ID is required")

    session = AgentSession(
        stt=openai.STT(model=os.getenv("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe")),
        llm=openai.LLM(model=os.getenv("OPENAI_LLM_MODEL", "gpt-4o-mini")),
        tts=fishaudio.TTS(
            voice_id=voice_id,
            model=os.getenv("FISH_TTS_MODEL", "s2-pro"),
            latency_mode="balanced",
        ),
        vad=silero.VAD.load(),
        turn_handling=TurnHandlingOptions(
            turn_detection=MultilingualModel(),
        ),
    )

    @session.on("agent_state_changed")
    def on_agent_state_changed(event: agents.AgentStateChangedEvent) -> None:
        logger.info("agent state changed: %s -> %s", event.old_state, event.new_state)

    @session.on("user_state_changed")
    def on_user_state_changed(event: agents.UserStateChangedEvent) -> None:
        logger.info("user state changed: %s -> %s", event.old_state, event.new_state)

    @session.on("overlapping_speech")
    def on_overlapping_speech(event: agents.OverlappingSpeechEvent) -> None:
        logger.info("overlapping speech detected: %s", event)

    @session.on("agent_false_interruption")
    def on_agent_false_interruption(event: agents.AgentFalseInterruptionEvent) -> None:
        logger.info("false interruption detected; resumed=%s", event.resumed)

    await session.start(room=ctx.room, agent=Assistant())
    await session.generate_reply(instructions="Greet the user briefly and invite them to speak.")


if __name__ == "__main__":
    agents.cli.run_app(server)
