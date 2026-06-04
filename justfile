set shell := ["fish", "-c"]
set dotenv-load
set positional-arguments

dev-agent-download-files:
    uv run --directory agent --module livekit.agents download-files

agent:
    op run --env-file .env -- uv run --directory agent agent.py dev

app:
    op run --env-file .env -- env CLOUDFLARE_INCLUDE_PROCESS_ENV=true bun --cwd app dev

server: app

web: app

dev:
    bun ./scripts/dev.ts

build:
    bun --cwd app build

format:
    oxfmt --config='oxfmt.config.ts' --write
    cd agent && uv format --preview-features format-command && cd ..
    shfmt --write .
    just --fmt --unstable
    tombi format

lint:
    echo $PWD
    oxlint --config='oxlint.config.ts' --type-aware --type-check --fix
    tombi lint
    pyrefly check --config agent/pyproject.toml
    bun --filter='*' check

fml: format lint
