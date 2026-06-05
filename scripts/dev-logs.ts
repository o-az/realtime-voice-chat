import { initLogger, log, type WideEvent } from 'evlog'

type Level = 'debug' | 'info' | 'warn' | 'error'

type LiveKitLog = {
  level?: string
  name?: string
  message?: string
  job_id?: string
  room_id?: string
  timestamp?: string
}

type EvlogLog = {
  action?: string
  duration?: string
  environment?: string
  identity?: string
  level?: string
  method?: string
  path?: string
  requestId?: string
  room?: string
  route?: string
  service?: string
  status?: number
  timestamp?: string
  voiceId?: string
}

type ProcessLogEvent = WideEvent & {
  daemon?: string
  eventTime?: string
  message?: string
  source?: string
  contextId?: string
}

const args = process.argv.slice(2)
const tail = !args.includes('--no-tail')
const sinceIndex = args.indexOf('--since')
const since = sinceIndex === -1 ? '1min' : (args[sinceIndex + 1] ?? '1min')
const pitchforkLine =
  /^(?:(?<daemon>[^\s]+)\s+)?(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (?<payload>.*)$/

initLogger({
  env: { service: 'fish-voice-dev', environment: process.env.NODE_ENV ?? 'development' },
  silent: true,
  drain: ({ event }) => {
    console.log(formatEvent(event as ProcessLogEvent))
  }
})

const pitchfork = Bun.spawn(
  [
    'mise',
    'exec',
    '--',
    'pitchfork',
    'logs',
    'app',
    'realtime',
    ...(tail ? ['--tail'] : []),
    '--raw',
    '--since',
    since,
    '--no-pager'
  ],
  {
    stdout: 'pipe',
    stderr: 'inherit'
  }
)

let pending = ''

for await (const chunk of pitchfork.stdout) {
  pending += new TextDecoder().decode(chunk)
  const lines = pending.split(/\r?\n/)
  pending = lines.pop() ?? ''

  for (const line of lines) {
    emitLine(line)
  }
}

if (pending) {
  emitLine(pending)
}

const exitCode = await pitchfork.exited
process.exit(exitCode)

function emitLine(line: string) {
  if (!line) {
    return
  }

  const event = parseLine(line)
  log[event.level]({
    action: 'process_log',
    daemon: event.daemon,
    eventTime: event.eventTime,
    message: event.message,
    source: event.source,
    contextId: event.contextId
  })
}

function parseLine(line: string): {
  level: Level
  daemon?: string
  eventTime: string
  message: string
  source?: string
  contextId?: string
} {
  const match = pitchforkLine.exec(line)
  if (!match?.groups) {
    return { level: 'info', eventTime: currentClockTime(), message: line }
  }

  const daemon = match.groups.daemon
  const eventTime = clockTime(match.groups.time)
  const payload = match.groups.payload ?? ''

  if (!payload.startsWith('{')) {
    return { level: 'info', daemon, eventTime, message: payload }
  }

  try {
    const parsed = JSON.parse(payload) as LiveKitLog | EvlogLog
    if (isEvlogLog(parsed)) {
      return {
        level: parseLevel(parsed.level),
        daemon,
        eventTime,
        message: formatEvlogMessage(parsed),
        contextId: compactRequestId(parsed.requestId)
      }
    }

    return {
      level: parseLevel(parsed.level),
      daemon,
      eventTime,
      message: parsed.message ?? payload,
      source: compactSource(parsed.name),
      contextId: compactLiveKitContext(parsed.room_id, parsed.job_id)
    }
  } catch {
    return { level: 'info', daemon, eventTime, message: payload }
  }
}

function formatEvent(event: ProcessLogEvent): string {
  const level = event.level.toUpperCase().padEnd(5)
  const prefix = [event.eventTime, event.daemon, level].filter(Boolean).join(' ')
  const context = event.contextId ? ` [${event.contextId}]` : ''
  return `${prefix} ${event.message ?? ''}${context}`
}

function isEvlogLog(value: LiveKitLog | EvlogLog): value is EvlogLog {
  return 'service' in value || 'environment' in value || 'requestId' in value
}

function formatEvlogMessage(event: EvlogLog): string {
  if (event.method && event.path && event.status) {
    return [
      event.method,
      event.path,
      event.status,
      event.duration ? `in ${event.duration}` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (event.action === 'token_issued') {
    return [
      'token issued',
      event.room ? `room=${event.room}` : undefined,
      event.identity ? `identity=${event.identity}` : undefined,
      event.voiceId ? `voice=${compactOpaqueId(event.voiceId)}` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (event.action === 'request_failed') {
    return ['request failed', event.path].filter(Boolean).join(' ')
  }

  return event.action ?? JSON.stringify(event)
}

function parseLevel(level: string | undefined): Level {
  switch (level?.toLowerCase()) {
    case 'debug':
      return 'debug'
    case 'warning':
    case 'warn':
      return 'warn'
    case 'error':
    case 'critical':
      return 'error'
    default:
      return 'info'
  }
}

function clockTime(value: string | undefined): string {
  return value?.slice(11, 19) ?? currentClockTime()
}

function currentClockTime(): string {
  return new Date().toTimeString().slice(0, 8)
}

function compactSource(name: string | undefined): string | undefined {
  if (!name || name === 'fish-voice-agent') {
    return undefined
  }
  return name.replace(/^livekit\.agents$/, 'lk.agents').replace(/^livekit\./, 'lk.')
}

function compactLiveKitContext(
  roomId: string | undefined,
  jobId: string | undefined
): string | undefined {
  if (roomId && jobId) {
    return `${compactOpaqueId(roomId)}/${compactOpaqueId(jobId)}`
  }
  return compactOpaqueId(roomId ?? jobId)
}

function compactRequestId(requestId: string | undefined): string | undefined {
  if (!requestId) {
    return undefined
  }
  return `req:${requestId.slice(0, 8)}`
}

function compactOpaqueId(value: string | undefined): string | undefined {
  if (!value || value.length <= 14) {
    return value
  }

  const [prefix, rest] = value.split('_', 2)
  if (prefix && rest && rest.length > 10) {
    return `${prefix}_${rest.slice(0, 4)}…${rest.slice(-4)}`
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
