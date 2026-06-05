# Fish Voice Agent

LiveKit voice agent for the realtime Fish voice chat demo.

## Local MisoTTS

MisoTTS runs as a separate Python 3.12 uv project because upstream MisoTTS currently requires Python `<3.13`, while this LiveKit agent runs on Python 3.14.

Start the local synth server in a separate terminal:

```sh
MISO_TTS_MODEL="/Users/o/.cache/huggingface/hub/models--MisoLabs--MisoTTS/snapshots/ef6b096cc35d3cde6aa0721013648416c14c36b2" just misotts
```

Then run the agent with:

```sh
TTS_PROVIDER=miso MISO_TTS_URL="http://127.0.0.1:8799" op run --env-file .env -- just dev
```

The first Miso server start loads the local 8B checkpoint and can take a while. The LiveKit adapter is non-streaming for now because upstream Miso exposes `generate(text=...) -> audio tensor`, not a streaming TTS protocol.
