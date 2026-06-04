import * as Bun from 'bun'
import { createLogger, initLogger, log } from 'evlog'

initLogger({
  env: {
    service: 'fish-voice-dev',
    environment: Bun.env.NODE_ENV ?? 'development'
  },
  pretty: true
})

type ProcessName = 'app' | 'agent'

type ProcessConfig = {
  name: ProcessName
  command: string[]
}

const processes: Array<ProcessConfig> = [
  { name: 'app', command: ['just', 'app'] },
  { name: 'agent', command: ['just', 'agent'] }
]

const children = new Map<ProcessName, Bun.Subprocess>()
let shuttingDown = false
const devLog = createLogger({ process: 'dev-supervisor' })

function prefixOutput(name: ProcessName, stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return

  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''

  void (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) process.stdout.write(`[${name}] ${line}\n`)
    }

    if (buffer) process.stdout.write(`[${name}] ${buffer}\n`)
  })().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error({ action: 'process_output_read_failed', child: name, error: errorMessage })
  })
}

function stopChildren(signal: NodeJS.Signals = 'SIGTERM') {
  shuttingDown = true
  log.info({ action: 'stopping_children', signal, childCount: children.size })
  for (const child of children.values()) {
    if (!child.killed && child.exitCode === null) child.kill(signal)
  }
}

devLog.set({ action: 'starting_children', children: processes.map(process => process.name) })
devLog.emit()

for (const config of processes) {
  const child = Bun.spawn(config.command, {
    cwd: import.meta.dir + '/..',
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
    onExit(_child, exitCode, signalCode, error) {
      children.delete(config.name)
      log.info({
        action: 'child_exited',
        child: config.name,
        exitCode,
        signalCode,
        error: error?.message,
        shuttingDown
      })
      if (shuttingDown) return

      const reason = error?.message ?? signalCode ?? `exit code ${exitCode ?? 'unknown'}`
      log.error({ action: 'child_failed', child: config.name, reason })
      stopChildren()
    }
  })

  children.set(config.name, child)
  log.info({ action: 'child_started', child: config.name, command: config.command.join(' ') })
  prefixOutput(config.name, child.stdout)
  prefixOutput(config.name, child.stderr)
}

process.on('SIGINT', () => stopChildren('SIGINT'))
process.on('SIGTERM', () => stopChildren('SIGTERM'))

await Promise.all([...children.values()].map(child => child.exited))
