import asyncio
import os
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Any
from uuid import uuid4

import aiohttp
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from loguru import logger
from pipecat.runner.daily import configure
from pipecat.transports.daily.utils import (
    DailyMeetingTokenProperties,
    DailyRoomProperties,
)
from pydantic import BaseModel, Field

from bot import BotConfig, run_bot

load_dotenv(override=False)


class StartRequest(BaseModel):
    fish_voice_id: str | None = Field(default=None, min_length=8, max_length=80)
    fish_model_id: str | None = None


class StartResponse(BaseModel):
    session_id: str
    url: str
    token: str
    room_url: str
    fish_voice_id: str
    provider: str = "daily"


class SessionInfo(BaseModel):
    session_id: str
    room_url: str
    fish_voice_id: str
    created_at: float
    done: bool
    cancelled: bool


class Session:
    def __init__(self, config: BotConfig, task: asyncio.Task[None]) -> None:
        self.config = config
        self.task = task
        self.created_at = time.time()


sessions: dict[str, Session] = {}
http_session: aiohttp.ClientSession | None = None


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise HTTPException(status_code=500, detail=f"{name} is required")
    return value


def int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise HTTPException(status_code=500, detail=f"{name} must be an integer") from error


def float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as error:
        raise HTTPException(status_code=500, detail=f"{name} must be a number") from error


def session_info(session_id: str, session: Session) -> SessionInfo:
    return SessionInfo(
        session_id=session_id,
        room_url=session.config.room_url,
        fish_voice_id=session.config.fish_voice_id,
        created_at=session.created_at,
        done=session.task.done(),
        cancelled=session.task.cancelled(),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_session
    http_session = aiohttp.ClientSession()
    try:
        yield
    finally:
        for session in sessions.values():
            if not session.task.done():
                session.task.cancel()
        if sessions:
            await asyncio.gather(
                *(session.task for session in sessions.values()),
                return_exceptions=True,
            )
        await http_session.close()


app = FastAPI(title="Fish Voice Realtime", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "fvc-realtime", "sessions": len(sessions)}


@app.post("/v1/start")
async def start(request: StartRequest) -> StartResponse:
    if http_session is None:
        raise HTTPException(status_code=503, detail="HTTP session is not ready")

    session_id = f"rt-{uuid4().hex[:10]}"
    room_geo = os.getenv("DAILY_ROOM_GEO") or None
    try:
        room_config = await configure(
            http_session,
            api_key=required_env("DAILY_API_KEY"),
            room_exp_duration=float(os.getenv("DAILY_ROOM_EXP_HOURS", "2")),
            token_exp_duration=float(os.getenv("DAILY_TOKEN_EXP_HOURS", "2")),
            room_properties=DailyRoomProperties(
                enable_chat=False,
                enable_prejoin_ui=False,
                eject_at_room_exp=True,
                exp=time.time() + float(os.getenv("DAILY_ROOM_EXP_HOURS", "2")) * 60 * 60,
                geo=room_geo,
                max_participants=2,
                start_video_off=True,
            ),
            token_properties=DailyMeetingTokenProperties(
                user_name="browser",
                start_video_off=True,
            ),
        )
    except Exception as error:
        detail = str(error)
        logger.error("daily room setup failed session={} error={}", session_id, detail)
        if "authentication-error" in detail or "status: 401" in detail:
            raise HTTPException(
                status_code=401,
                detail="Daily rejected DAILY_API_KEY while creating a room",
            ) from error
        raise HTTPException(status_code=502, detail=detail) from error

    fish_voice_id = request.fish_voice_id or required_env("FISH_VOICE_ID")
    fish_model_id = request.fish_model_id or os.getenv("FISH_TTS_MODEL", "s2-pro")
    bot_config = BotConfig(
        session_id=session_id,
        room_url=room_config.room_url,
        token=room_config.token,
        fish_voice_id=fish_voice_id,
        fish_model_id=fish_model_id,
        fish_latency=os.getenv("FISH_TTS_LATENCY_MODE", "low"),
        fish_stop_frame_timeout_s=float_env("FISH_TTS_STOP_FRAME_TIMEOUT_SECONDS", 12.0),
        xai_stt_language=os.getenv("XAI_STT_LANGUAGE", "en"),
        xai_stt_endpointing_ms=int_env("XAI_STT_ENDPOINTING_MS", 100),
        xai_llm_model=os.getenv("XAI_LLM_MODEL", "grok-4.3"),
    )

    task = asyncio.create_task(run_bot(bot_config), name=f"pipecat-{session_id}")
    sessions[session_id] = Session(bot_config, task)
    task.add_done_callback(
        lambda done_task: logger.info("session done {} {}", session_id, done_task)
    )

    logger.info("started session={} config={}", session_id, asdict(bot_config))

    return StartResponse(
        session_id=session_id,
        url=room_config.room_url,
        token=room_config.token,
        room_url=room_config.room_url,
        fish_voice_id=fish_voice_id,
    )


@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: str) -> SessionInfo:
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_info(session_id, session)


@app.post("/v1/sessions/{session_id}/stop")
async def stop_session(session_id: str) -> SessionInfo:
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.task.done():
        session.task.cancel()
    return session_info(session_id, session)


@app.post("/v1/tts")
async def tts_not_ready() -> dict[str, str]:
    return {"status": "reserved", "message": "Direct TTS diagnostics are not wired yet"}


@app.post("/v1/stt")
async def stt_not_ready() -> dict[str, str]:
    return {"status": "reserved", "message": "Direct STT diagnostics are not wired yet"}


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=os.getenv("REALTIME_HOST", "127.0.0.1"),
        port=int_env("REALTIME_PORT", 8791),
        reload=os.getenv("REALTIME_RELOAD", "false").lower() == "true",
    )
