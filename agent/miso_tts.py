from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request

from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions, APIError, APIStatusError
from livekit.agents.tts import TTS, AudioEmitter, ChunkedStream, TTSCapabilities
from livekit.agents.utils import shortuuid


class MisoTTS(TTS):
    def __init__(
        self,
        *,
        url: str,
        speaker: int,
        sample_rate: int,
        max_audio_length_ms: int,
        timeout_seconds: float,
    ) -> None:
        super().__init__(
            capabilities=TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._url = url.rstrip("/")
        self._speaker = speaker
        self._max_audio_length_ms = max_audio_length_ms
        self._timeout_seconds = timeout_seconds

    @property
    def model(self) -> str:
        return os.getenv("MISO_TTS_MODEL", "MisoLabs/MisoTTS")

    @property
    def provider(self) -> str:
        return "miso"

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> ChunkedStream:
        return MisoChunkedStream(
            tts=self,
            input_text=text,
            conn_options=APIConnectOptions(max_retry=0, timeout=conn_options.timeout),
        )

    def synthesize_pcm(self, text: str) -> bytes:
        payload = json.dumps(
            {
                "text": text,
                "speaker": self._speaker,
                "maxAudioLengthMs": self._max_audio_length_ms,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self._url}/synthesize",
            data=payload,
            headers={"content-type": "application/json", "accept": "audio/pcm"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise APIStatusError(
                message=f"MisoTTS synthesis failed: {body}",
                status_code=error.code,
                request_id=None,
                body=body,
                retryable=False,
            ) from error
        except urllib.error.URLError as error:
            raise APIError(f"MisoTTS request failed: {error.reason}", retryable=False) from error


class MisoChunkedStream(ChunkedStream):
    async def _run(self, output_emitter: AudioEmitter) -> None:
        tts = self._tts
        if not isinstance(tts, MisoTTS):
            raise TypeError("MisoChunkedStream requires MisoTTS")

        output_emitter.initialize(
            request_id=shortuuid(),
            sample_rate=tts.sample_rate,
            num_channels=tts.num_channels,
            mime_type="audio/pcm",
            frame_size_ms=40,
            stream=False,
        )
        pcm = await asyncio.to_thread(tts.synthesize_pcm, self.input_text)
        output_emitter.push(pcm)
        output_emitter.flush()
