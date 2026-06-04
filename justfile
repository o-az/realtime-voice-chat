set shell := ["fish", "-c"]
set dotenv-load
set positional-arguments

dev-agent:
    op run --env-file .env -- uv run --directory agent agent.py dev

dev-agent-download-files:
    uv run --directory agent --module livekit.agents download-files

dev-server:
    op run --env-file .env -- bun run --cwd server dev

dev-web:
    bun run --cwd web dev

dev:
    bun run scripts/dev.ts

check-all:
    bun run --cwd server check

check-web:
    bun run --cwd web check

check-server:
    bun run --cwd server check

check-agent:
    uv run --directory agent ruff check .

check-agent-types:
    uv run --directory agent pyright

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

fml: format lint
