import * as Bun from 'bun'

type ProcessName = 'server' | 'web' | 'agent'

type ProcessConfig = {
  name: ProcessName
  command: string[]
}

const processes: Array<ProcessConfig> = [
  { name: 'server', command: ['bun', 'run', 'dev:server'] },
  { name: 'web', command: ['bun', 'run', 'dev:web'] },
  { name: 'agent', command: ['bun', 'run', 'dev:agent'] }
]

const children = new Map<ProcessName, Bun.Subprocess>()
let shuttingDown = false

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
    console.error(`[${name}] failed to read process output`, errorMessage)
  })
}

function stopChildren(signal: NodeJS.Signals = 'SIGTERM') {
  shuttingDown = true
  for (const child of children.values()) {
    if (!child.killed && child.exitCode === null) child.kill(signal)
  }
}

for (const config of processes) {
  const child = Bun.spawn(config.command, {
    cwd: import.meta.dir + '/..',
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
    onExit(_child, exitCode, signalCode, error) {
      children.delete(config.name)
      if (shuttingDown) return

      const reason = error?.message ?? signalCode ?? `exit code ${exitCode ?? 'unknown'}`
      console.error(`[${config.name}] exited: ${reason}`)
      stopChildren()
    }
  })

  children.set(config.name, child)
  prefixOutput(config.name, child.stdout)
  prefixOutput(config.name, child.stderr)
}

process.on('SIGINT', () => stopChildren('SIGINT'))
process.on('SIGTERM', () => stopChildren('SIGTERM'))

await Promise.all([...children.values()].map(child => child.exited))
