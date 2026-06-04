import { Hono } from 'hono'
import { html } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'

// https://hono.dev/docs/guides/jsx#jsx
// https://hono.dev/docs/helpers/html
// https://hono.dev/docs/middleware/builtin/jsx-renderer

// https://unocss.dev/integrations/runtime

export const landingApp = new Hono<{ Bindings: Cloudflare.Env }>()

landingApp.get(
  '/',
  jsxRenderer(({ children }) => {
    return (
      <html lang='en'>
        <head>
          <head>
            <meta charset='UTF-8' />
            <meta
              name='viewport'
              content='width=device-width, initial-scale=1.0'
            />
            {html /* js */ `
            <script>
            window.__unocss = {
              presets: [
                () =>
                  window.__unocss_runtime.presets.presetIcons({
                    scale: 1.2,
                    cdn: 'https://esm.sh/',
                  }),
              ],
            }
            </script>
            `}
            <script src='https://esm.run/@unocss/runtime'></script>
            <link
              rel='stylesheet'
              href='https://esm.run/@unocss/reset/normalize.min.css'
            />
            <title>Fish Voice Chat</title>
          </head>
        </head>
        <body>{/* ... */}</body>
      </html>
    )
  })
)
