import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import evlog from 'evlog/vite'

export default defineConfig({
  plugins: [
    evlog({
      service: 'fish-voice-web',
      strip: ['debug'],
      sourceLocation: 'dev',
      environment: Bun.env.NODE_ENV ?? 'development'
    }),
    tailwindcss()
  ],
  server: {
    proxy: {
      '/api': {
        changeOrigin: true,
        target: 'http://127.0.0.1:6363',
        rewrite: path => {
          Bun.sleepSync(1_000)
          return path.replace(/^\/api/, '')
        }
      }
    }
  }
})
