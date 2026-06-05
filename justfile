set shell := ["fish", "-c"]
set dotenv-load
set positional-arguments

dev-agent-download-files:
    uv run --directory agent --module livekit.agents download-files

agent:
    op run --env-file .env -- mise exec -- pitchfork start realtime

realtime:
    mise exec -- pitchfork start realtime

livekit-agent:
    op run --env-file .env -- fish -c 'if test "$TTS_PROVIDER" = miso; mise exec -- pitchfork start misotts agent; else mise exec -- pitchfork start agent; end'

app:
    mise exec -- pitchfork start app

misotts:
    uv run --directory misotts --python 3.12 server.py

server: app

web: app

dev:
    mise exec -- pitchfork start app realtime
    bun scripts/dev-logs.ts

dev-logs:
    bun scripts/dev-logs.ts

dev-logs-tspin:
    bun scripts/dev-logs.ts | mise exec -- tspin --print --highlight 'cyan:fvc/app,fvc/realtime' --highlight 'magenta:transcript user,transcript agent' --highlight 'green:listening,speaking,thinking,connected,ready'

dev-status:
    mise exec -- pitchfork list

dev-restart:
    mise exec -- pitchfork restart app realtime
    bun scripts/dev-logs.ts

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
check: fml
