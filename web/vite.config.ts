import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        changeOrigin: true,
        target: 'http://127.0.0.1:8787',
        rewrite: path => {
          Bun.sleepSync(1_000)
          return path.replace(/^\/api/, '')
        }
      }
    }
  }
})
