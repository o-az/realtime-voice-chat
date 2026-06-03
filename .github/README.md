# Realtime Fish Voice Chat

Minimal browser-to-LiveKit voice chat with a Python LiveKit agent that uses Fish Audio for TTS.

## Verified Tooling Contracts

- JavaScript runs through Bun. Do not use npm, pnpm, or yarn commands for this repo.
- The token server runs on Bun's native HTTP server, not Express.
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
bun dev
```

`bun dev` uses `scripts/dev.ts` as a Bun-native process supervisor for the server, Vite web app, and Python agent. The server dev command uses Bun hot reload so the Bun process stays up while request handlers update.

Or run them separately:

```sh
bun dev:server
bun dev:web
bun dev:agent
```

## Environment

The checked-in `.env` contains only 1Password references. It is used like this:

```sh
op run --env-file .env -- bun dev:server
op run --env-file .env -- uv run --directory agent agent.py dev
```

## Local HTTPS With Tailscale

The Vite app proxies `/api` to the local token server, so the browser only needs to talk to the web origin. After `bun run dev` is running, expose Vite through Tailscale Serve:

```sh
tailscale serve --bg https:443 http://127.0.0.1:5173
```

Reset the serve config when finished:

```sh
tailscale serve reset
```
