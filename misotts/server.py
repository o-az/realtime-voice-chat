from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "60")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
os.environ.setdefault("NO_TORCH_COMPILE", "1")

import torch
from generator import DEFAULT_MISO_TTS_REPO_ID, load_miso_8b

logger = logging.getLogger("misotts")


class MisoSynthesizer:
    def __init__(
        self,
        *,
        model: str,
        device: str,
        speaker: int,
        max_audio_length_ms: int,
        temperature: float,
        topk: int,
        dtype: torch.dtype,
    ) -> None:
        logger.info("loading MisoTTS model=%s device=%s dtype=%s", model, device, dtype)
        self._generator = load_miso_8b(device=device, model_path_or_repo_id=model, dtype=dtype)
        self._speaker = speaker
        self._max_audio_length_ms = max_audio_length_ms
        self._temperature = temperature
        self._topk = topk
        self._lock = threading.Lock()

    @property
    def sample_rate(self) -> int:
        return int(self._generator.sample_rate)

    def synthesize(self, text: str, speaker: int | None = None) -> bytes:
        with self._lock:
            audio = self._generator.generate(
                text=text,
                speaker=self._speaker if speaker is None else speaker,
                context=[],
                max_audio_length_ms=self._max_audio_length_ms,
                temperature=self._temperature,
                topk=self._topk,
            )
        return tensor_to_s16le(audio)


def tensor_to_s16le(audio: torch.Tensor) -> bytes:
    mono = audio.detach().to(device="cpu", dtype=torch.float32).flatten()
    mono = torch.clamp(mono, -1.0, 1.0)
    pcm = (mono * 32767.0).to(torch.int16).contiguous()
    return pcm.numpy().tobytes()


def parse_json(body: bytes) -> dict[str, Any]:
    parsed = json.loads(body.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Expected a JSON object")
    return parsed


def make_handler(synthesizer: MisoSynthesizer) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "fvc-misotts/0.1"

        def do_GET(self) -> None:
            if self.path == "/favicon.ico":
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return

            if self.path == "/":
                self.write_json(
                    {
                        "ok": True,
                        "service": "fvc-misotts",
                        "sampleRate": synthesizer.sample_rate,
                        "endpoints": {
                            "health": "GET /health",
                            "synthesize": "POST /synthesize",
                        },
                    }
                )
                return

            if self.path != "/health":
                self.send_error(HTTPStatus.NOT_FOUND)
                return

            self.write_json({"ok": True, "sampleRate": synthesizer.sample_rate})

        def do_POST(self) -> None:
            if self.path != "/synthesize":
                self.send_error(HTTPStatus.NOT_FOUND)
                return

            try:
                content_length = int(self.headers.get("content-length", "0"))
                body = parse_json(self.rfile.read(content_length))
                text = body.get("text")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("text is required")

                speaker = body.get("speaker")
                if speaker is not None and not isinstance(speaker, int):
                    raise ValueError("speaker must be an integer")

                pcm = synthesizer.synthesize(text.strip(), speaker=speaker)
            except Exception as error:
                logger.exception("synthesis failed")
                self.write_json(
                    {
                        "error": str(error) or type(error).__name__,
                        "errorType": type(error).__name__,
                        "traceback": traceback.format_exc(limit=8),
                    },
                    status=HTTPStatus.BAD_REQUEST,
                )
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("content-type", "audio/pcm")
            self.send_header("x-sample-rate", str(synthesizer.sample_rate))
            self.send_header("x-num-channels", "1")
            self.send_header("content-length", str(len(pcm)))
            self.end_headers()
            self.wfile.write(pcm)

        def write_json(self, value: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
            payload = json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: object) -> None:
            logger.info(format, *args)

    return Handler


def best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def torch_dtype(value: str, device: str) -> torch.dtype:
    normalized = value.lower()
    if normalized == "auto":
        return torch.float16 if device == "mps" else torch.bfloat16
    if normalized in {"float16", "fp16"}:
        return torch.float16
    if normalized in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if normalized in {"float32", "fp32"}:
        return torch.float32
    raise ValueError(f"Unsupported MISO_TTS_DTYPE: {value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("MISO_TTS_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MISO_TTS_PORT", "8799")))
    parser.add_argument(
        "--model",
        default=os.getenv(
            "MISO_TTS_MODEL", os.getenv("MISO_TTS_8B_MODEL", DEFAULT_MISO_TTS_REPO_ID)
        ),
    )
    parser.add_argument("--device", default=os.getenv("MISO_TTS_DEVICE", best_device()))
    parser.add_argument("--speaker", type=int, default=int(os.getenv("MISO_TTS_SPEAKER", "0")))
    parser.add_argument("--dtype", default=os.getenv("MISO_TTS_DTYPE", "auto"))
    parser.add_argument(
        "--max-audio-length-ms",
        type=int,
        default=int(os.getenv("MISO_TTS_MAX_AUDIO_LENGTH_MS", "10000")),
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=float(os.getenv("MISO_TTS_TEMPERATURE", "0.9")),
    )
    parser.add_argument("--topk", type=int, default=int(os.getenv("MISO_TTS_TOPK", "50")))
    args = parser.parse_args()
    dtype = torch_dtype(args.dtype, args.device)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    synthesizer = MisoSynthesizer(
        model=args.model,
        device=args.device,
        speaker=args.speaker,
        max_audio_length_ms=args.max_audio_length_ms,
        temperature=args.temperature,
        topk=args.topk,
        dtype=dtype,
    )

    server = ThreadingHTTPServer((args.host, args.port), make_handler(synthesizer))
    logger.info("MisoTTS server listening on http://%s:%s", args.host, args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
