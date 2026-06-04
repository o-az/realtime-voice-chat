import { Hono } from 'hono'
import { html } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'

// https://hono.dev/docs/guides/jsx#jsx
// https://hono.dev/docs/helpers/html
// https://hono.dev/docs/middleware/builtin/jsx-renderer

// https://unocss.dev/integrations/runtime

export const landingApp = new Hono<{ Bindings: Cloudflare.Env }>()
const clientScriptPath = import.meta.env.DEV ? '/src/client.ts' : '/assets/client.js'

const styles = html`
  <style>
    :root {
      color: #18181b;
      background: #f7f7f8;
      font-family: monospace;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
    }

    main {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 56px 24px 20px;
      gap: 18px;
    }

    .call {
      width: min(100%, 420px);
      display: grid;
      gap: 12px;
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    #status-dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #a1a1aa;
    }

    #status-dot[data-state='connected'] {
      background: #16a34a;
    }

    #status-dot[data-state='connecting'],
    #status-dot[data-state='reconnecting'] {
      background: #d97706;
    }

    #status-dot[data-state='error'] {
      background: #dc2626;
    }

    #status {
      min-height: 24px;
      margin: 0;
      font-size: 15px;
      line-height: 1.5;
    }

    label {
      display: grid;
      gap: 8px;
      color: #52525b;
      font-size: 13px;
      font-weight: 600;
    }

    input {
      width: 100%;
      min-height: 44px;
      padding: 9px 12px;
      border: 1px solid #d4d4d8;
      border-radius: 6px;
      background: #ffffff;
      color: #18181b;
      font: inherit;
    }

    .transcript {
      width: min(100%, 1040px);
      flex: 1;
      min-height: 420px;
      display: grid;
      border-top: 1px solid #d4d4d8;
      padding-top: 16px;
    }

    .transcript-lines {
      min-height: 420px;
      max-height: calc(100vh - 360px);
      overflow: auto;
      padding: 6px 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .transcript-line {
      margin: 0;
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 12px;
      align-items: baseline;
      color: #18181b;
      font-size: 15px;
      line-height: 1.55;
    }

    .transcript-line.partial .text {
      color: #71717a;
    }

    .speaker {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .speaker.you {
      color: #0f766e;
    }

    .speaker.agent {
      color: #7c3aed;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .control-menu {
      border-top: 1px solid #e4e4e7;
      padding-top: 10px;
      display: flex;
      justify-content: center;
      gap: 8px;
    }

    .icon-button {
      width: 38px;
      min-height: 38px;
      height: 38px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      background: #3f3f46;
      padding: 0;
    }

    .icon-button.active {
      background: #be123c;
    }

    .mic-icon {
      width: 19px;
      height: 19px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .icon-button.active .mic-icon {
      opacity: 0.95;
    }

    .icon-button.active::after {
      content: '';
      position: absolute;
      width: 21px;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
      transform: rotate(-45deg);
    }

    button {
      position: relative;
      min-height: 44px;
      border: 0;
      border-radius: 6px;
      background: #18181b;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  </style>
`

landingApp.use(
  '*',
  jsxRenderer(({ children }) => {
    return (
      <html lang='en'>
        <head>
          <meta charset='UTF-8' />
          <meta
            name='viewport'
            content='width=device-width, initial-scale=1.0'
          />
          {html /* js */ `
            <script src="https://cdn.jsdelivr.net/npm/@unocss/runtime/preset-icons.global.js"></script>
            <script>
            window.__unocss = {
              presets: [
                () =>
                  window.__unocss_runtime.presets.presetIcons({
                    scale: 1.2,
                    cdn: 'https://esm.sh/',
                  }),
              ],
            }</script>`}
          {html /* js */ `<script src="https://cdn.jsdelivr.net/npm/@unocss/runtime"></script>`}
          {html
          /* js */ `<script src="https://cdn.jsdelivr.net/npm/@unocss/runtime/attributify.global.js"></script>`}
          <link
            rel='stylesheet'
            href='https://cdn.jsdelivr.net/npm/@unocss/reset/normalize.css'
          />
          <title>Fish Voice Chat</title>
          {styles}
        </head>
        <body class='antialiased bg-red-500'>
          {children}
          <script
            type='module'
            src={clientScriptPath}
          />
        </body>
      </html>
    )
  })
)

landingApp.get('/', context =>
  context.render(
    <main>
      <section class='call'>
        <div class='status-row text-red-500!'>
          <span
            id='status-dot'
            aria-hidden='true'
          />
          <p id='status'>Disconnected</p>
        </div>

        <h1 class='bg-red-500'>hahaohho</h1>

        <label>
          Room
          <input
            id='room'
            autocorrect='off'
            autocomplete='off'
            spellcheck={false}
            autocapitalize='off'
          />
        </label>

        <label>
          Fish voice ID
          <input
            id='voice-id'
            autocorrect='off'
            autocomplete='off'
            spellcheck={false}
            autocapitalize='off'
          />
        </label>

        <div class='actions'>
          <button
            id='connect'
            type='button'>
            Connect
          </button>
          <button
            id='disconnect'
            type='button'
            disabled>
            Disconnect
          </button>
        </div>

        <div
          class='control-menu'
          aria-label='Call controls'>
          <button
            id='mute'
            class='icon-button'
            type='button'
            disabled
            aria-pressed='false'
            aria-label='Mute microphone'
            title='Mute microphone'>
            <svg
              class='mic-icon'
              aria-hidden='true'
              viewBox='0 0 24 24'>
              <path d='M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z' />
              <path d='M5 10v1a7 7 0 0 0 14 0v-1' />
              <path d='M12 18v3' />
              <path d='M8 21h8' />
            </svg>
          </button>
        </div>

        <audio
          id='remote-audio'
          autoplay
          playsinline
        />
      </section>

      <section
        class='transcript'
        aria-label='Live transcript'>
        <div
          id='transcript-lines'
          class='transcript-lines'
        />
      </section>
    </main>
  )
)
