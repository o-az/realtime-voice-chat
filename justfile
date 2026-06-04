set shell := ["fish", "-c"]
set dotenv-load
set positional-arguments

dev-agent-download-files:
    uv run --directory agent --module livekit.agents download-files

agent:
    op run --env-file .env -- mise exec -- pitchfork start agent

app:
    op run --env-file .env -- mise exec -- pitchfork start app

server: app

web: app

dev:
    op run --env-file .env -- mise exec -- pitchfork start --local
    mise exec -- pitchfork logs app agent --tail --raw --since 1min --no-pager

dev-logs:
    mise exec -- pitchfork logs app agent --tail --raw --since 1min --no-pager

dev-status:
    mise exec -- pitchfork list

dev-restart:
    op run --env-file .env -- mise exec -- pitchfork restart --local
    mise exec -- pitchfork logs app agent --tail --raw

dev-stop:
    mise exec -- pitchfork stop --local

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
