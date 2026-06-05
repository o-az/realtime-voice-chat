import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as z from 'zod'
import { ConsoleTemplate, Input } from '@pipecat-ai/voice-ui-kit'

import '#app/style.css'

const rootElement = document.querySelector('div#root')
if (!rootElement) throw new Error('Root element not found')

const configSchema = z.object({
  defaultFishVoiceId: z.string()
})

const configPromise = fetch('/api/config').then(async response => {
  const json = await response.json()
  return configSchema.parse(json)
})

function App() {
  return (
    <React.Suspense
      fallback={
        <main className='grid min-h-screen place-items-center bg-background text-sm text-muted-foreground'>
          Loading voice console...
        </main>
      }>
      <VoiceConsole />
    </React.Suspense>
  )
}

function VoiceConsole() {
  const config = React.use(configPromise)
  const [fishVoiceId, setFishVoiceId] = React.useState(config.defaultFishVoiceId)
  const startRequestData: Record<string, string> = fishVoiceId.trim()
    ? { fishVoiceId: fishVoiceId.trim() }
    : {}

  return (
    <main className='relative h-screen overflow-hidden bg-background'>
      <div className='fixed left-2 top-2 z-50 w-[min(18rem,calc(100vw-4.75rem))]'>
        <Input
          aria-label='Fish voice ID'
          value={fishVoiceId}
          onChange={event => setFishVoiceId(event.currentTarget.value)}
          spellCheck={false}
          autoComplete='off'
          placeholder='Fish voice ID'
          size='sm'
        />
      </div>

      <ConsoleTemplate
        transportType='daily'
        transportOptions={{ bufferLocalAudioUntilBotReady: true }}
        startBotParams={{
          endpoint: '/api/start',
          requestData: startRequestData,
          timeout: 15_000
        }}
        titleText='Fish Voice'
        assistantLabelText='Agent'
        userLabelText='You'
        systemLabelText='System'
        theme='system'
        noLogo
        noThemeSwitch
        noUserVideo
        noScreenControl
        noBotVideo
        noTextRenderModeSwitch
        textRenderMode='karaoke'
        conversationElementProps={{
          noTextInput: false,
          assistantLabel: 'Agent',
          clientLabel: 'You',
          textRenderMode: 'karaoke'
        }}
      />
    </main>
  )
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
