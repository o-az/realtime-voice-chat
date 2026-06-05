import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import {
  cn,
  ThemeProvider,
  /**
   * O:
   *
   * This component has every thing we need: input / output control, chat transcripts, chat input,
   * etc. it is also highly configurable and has a bunch of useful methods like `onClient`,
   * `onServer`, `onInjectMessage`, etc. we should use it
   */
  ConsoleTemplate,
  /**
   * O: Higher-order component that streamlines setup of a Pipecat Client instance it handles a
   * bunch of stuff for you
   */
  PipecatAppBase,
  /**
   * O:
   *
   * @link docs https://voiceuikit.pipecat.ai/components/TranscriptOverlay
   * @link example https://github.com/pipecat-ai/voice-ui-kit/blob/main/package/src/components/elements/TranscriptOverlay.tsx
   */
  TranscriptOverlayComponent
} from '@pipecat-ai/voice-ui-kit'
import {
  usePipecatClient,
  PipecatClientAudio,
  type BotOutputText,
  PipecatClientProvider,
  usePipecatConversation,
  type ConversationMessage,
  usePipecatClientMicControl,
  type ConversationMessagePart,
  usePipecatClientTransportState
} from '@pipecat-ai/client-react'
import { PipecatClient } from '@pipecat-ai/client-js'
import { DailyTransport } from '@pipecat-ai/daily-transport'

import '#app/style.css'

const rootElement = document.querySelector('div#root')
if (!rootElement) throw new Error('Root element not found')

const pipecatClient = new PipecatClient({
  enableMic: true,
  enableCam: false,
  transport: new DailyTransport({ bufferLocalAudioUntilBotReady: true })
}) as unknown as React.ComponentProps<typeof PipecatClientProvider>['client']

// O: don't do this. Just inline types like this
type StartStatus = 'idle' | 'connecting' | 'connected' | 'error'

function partText(part: ConversationMessagePart): string {
  const text = part.text
  if (typeof text === 'string') return text
  if (isBotOutputText(text)) return [text.spoken, text.unspoken].filter(Boolean).join('')
  if (typeof text === 'number' || typeof text === 'boolean') return String(text)
  return ''
}

// O: there has got to be a saner more reasonable way of detecting if bot. This is yucky.
function isBotOutputText(value: unknown): value is BotOutputText {
  return typeof value === 'object' && value !== null && ('spoken' in value || 'unspoken' in value)
}

// O: seems rather useless
function messageText(message: ConversationMessage): string {
  return message.parts.map(partText).join('').trim()
}

export function App() {
  return (
    <Providers>
      <VoiceApp />
    </Providers>
  )
}

function VoiceApp() {
  const client = usePipecatClient()
  const transportState = usePipecatClientTransportState()
  const { messages } = usePipecatConversation()
  const [voiceId, setVoiceId] = React.useState('')
  const [status, setStatus] = React.useState<StartStatus>('idle')
  const [error, setError] = React.useState<string | null>(null)

  // O: do you need useEffect for this? Lookup React v19 https://react.dev/reference/react
  React.useEffect(() => {
    let active = true
    fetch('/api/config')
      // O: this is ugly and sad. Use zod and "do not trust, verify"
      .then(response => response.json() as Promise<{ defaultFishVoiceId: string }>)
      .then(config => {
        if (active) setVoiceId(config.defaultFishVoiceId)
      })
      .catch(() => {
        if (active) setError('Could not load config')
      })
    return () => {
      active = false
    }
  }, [])

  // O: do you need useEffect for this? Lookup React v19 https://react.dev/reference/react
  React.useEffect(() => {
    const serialized = messages
      .map(message => ({ role: message.role, text: messageText(message), final: message.final }))
      .filter(message => message.text)
    localStorage.setItem('fvc.transcript', JSON.stringify(serialized))
  }, [messages])

  // O: starting to smell when there are too many useEffects.
  React.useEffect(() => {
    if (transportState === 'ready' || transportState === 'connected') setStatus('connected')
    if (transportState === 'disconnected' && status !== 'error') setStatus('idle')
  }, [status, transportState])

  const connect = async () => {
    if (!client || status === 'connecting') return
    setError(null)
    setStatus('connecting')
    try {
      await client.startBotAndConnect({
        endpoint: '/api/start',
        requestData: { fishVoiceId: voiceId },
        timeout: 15_000
      })
      setStatus('connected')
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'Could not connect')
    }
  }

  /** O: this is only used one time? just inline it into the onClick handler */
  const disconnect = async () => {
    if (!client) return
    await client.disconnect()
    setStatus('idle')
  }

  const canConnect = Boolean(client && voiceId && status !== 'connecting' && status !== 'connected')
  const canDisconnect = Boolean(client && status === 'connected')

  return (
    <main className='shell'>
      <PipecatClientAudio />
      <section
        className='controls'
        aria-label='Voice session controls'>
        <div className='status-row'>
          <span className={`status-dot status-${status}`} />
          <span>{statusLabel(status, transportState)}</span>
        </div>

        <label className='field'>
          <span>Fish voice ID</span>
          <input
            value={voiceId}
            onChange={event => setVoiceId(event.currentTarget.value)}
            spellCheck={false}
            autoComplete='off'
          />
        </label>

        <div className='button-row'>
          <button
            type='button'
            onClick={connect}
            disabled={!canConnect}>
            Connect
          </button>
          <button
            type='button'
            onClick={disconnect}
            disabled={!canDisconnect}>
            Disconnect
          </button>
          <MicButton disabled={!canDisconnect} />
        </div>

        {error ? <p className='error'>{error}</p> : null}
      </section>

      <Transcript messages={messages} />
    </main>
  )
}

function statusLabel(status: StartStatus, transportState: string): string {
  if (status === 'error') return `Error (${transportState})`
  if (status === 'connecting') return `Connecting (${transportState})`
  if (status === 'connected') return `Connected (${transportState})`
  return `Idle (${transportState})`
}

function MicButton(props: { disabled: boolean }) {
  const { enableMic, isMicEnabled } = usePipecatClientMicControl()
  return (
    <button
      className={`mic-button ${isMicEnabled ? '' : 'muted'}`}
      type='button'
      disabled={props.disabled}
      aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
      title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
      onClick={() => enableMic(!isMicEnabled)}>
      {isMicEnabled ? 'Mic' : 'Off'}
    </button>
  )
}

function Transcript(props: { messages: ConversationMessage[] }) {
  const transcript = props.messages
    .map(message => ({ ...message, text: messageText(message) }))
    .filter(message => message.text)

  return (
    <section
      className='transcript'
      aria-label='Transcript'>
      {transcript.length ? (
        transcript.map((message, index) => (
          <article
            className={`line ${message.role}`}
            key={`${message.createdAt}-${index}`}>
            <span>{message.role === 'assistant' ? 'Agent' : 'You'}</span>
            <p>{message.text}</p>
          </article>
        ))
      ) : (
        <p className='empty'>Transcript will appear here.</p>
      )}
    </section>
  )
}

export function Providers(props: React.PropsWithChildren) {
  return (
    <ThemeProvider>
      <PipecatClientProvider client={pipecatClient}>{props.children}</PipecatClientProvider>
    </ThemeProvider>
  )
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
