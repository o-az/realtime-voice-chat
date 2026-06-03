# Realtime Fish Voice Chat

Minimal browser-to-LiveKit voice chat with a Python LiveKit agent that uses Fish Audio for TTS.

## Verified Tooling Contracts

- JavaScript runs through Bun. Do not use npm, pnpm, or yarn commands for this repo.
- Python runs through uv. Do not call `python`, `python3`, or `pip` directly.
- Secrets are resolved through 1Password with `op run --env-file .env -- ...`.
- LiveKit handles WebRTC media, turn detection, and interruption behavior. This repo does not implement raw WebRTC or direct Fish WebSocket plumbing.

## Setup

Install dependencies:

```sh
bun install
uv sync --directory agent
uv run --directory agent --module livekit.agents download-files
```

Run all development processes:

```sh
bun run dev
```

Or run them separately:

```sh
bun run dev:server
bun run dev:web
bun run dev:agent
```

## Environment

The checked-in `.env` contains only 1Password references. It is used like this:

```sh
op run --env-file .env -- bun run dev:server
op run --env-file .env -- uv run --directory agent agent.py dev
```
