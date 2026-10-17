import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Local stand-in for relay/worker.js: lets `npm run dev` read RSS feeds that
// don't send CORS headers. Production builds use the deployed worker instead.
function feedRelay(): Plugin {
  return {
    name: 'feed-relay',
    configureServer(server) {
      server.middlewares.use('/relay', async (req, res) => {
        const target = new URL(req.url ?? '', 'http://x').searchParams.get('url')
        if (!target || !/^https?:\/\//.test(target)) {
          res.statusCode = 400
          res.end('missing url')
          return
        }
        try {
          const upstream = await fetch(target, {
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; BGCC-Content-Desk/1.0; student project)' },
            signal: AbortSignal.timeout(15000),
          })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'text/plain')
          res.end(Buffer.from(await upstream.arrayBuffer()))
        } catch (err) {
          res.statusCode = 502
          res.end(String(err))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), feedRelay()],
})
