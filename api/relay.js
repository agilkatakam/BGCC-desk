// Vercel Edge Function: the same feed relay as relay/worker.js, so a Vercel deploy needs no setup.
import worker from '../relay/worker.js'

export const config = { runtime: 'edge' }

export default (request) => worker.fetch(request)
