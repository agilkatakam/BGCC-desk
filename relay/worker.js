// Cloudflare Worker feed relay (free plan). Deploy, then paste its URL into
// Settings → Feed relay. It forwards GET requests only, and API keys never pass through it.
// Feeds come from the hosts below; any other https host may only return a web page or an image
// (the slide pictures: article lead photos and the photos themselves), up to 8 MB.
const ALLOWED = [
  'news.google.com', 'trends.google.com', 'economictimes.indiatimes.com',
  'www.livemint.com', 'www.business-standard.com',
  'www.thehindubusinessline.com', 'www.thehindu.com', 'inc42.com', 'yourstory.com',
  'www.producthunt.com', 'stratechery.com', 'hnrss.org',
]
const PICTURE_TYPES = /^(text\/html|image\/)/

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url')
    const cors = { 'access-control-allow-origin': '*' }
    if (!target) return new Response('missing url', { status: 400, headers: cors })
    const url = new URL(target)
    const feedHost = ALLOWED.includes(url.hostname) || url.hostname.endsWith('.substack.com')
    if (!feedHost && url.protocol !== 'https:') return new Response('https only', { status: 403, headers: cors })
    const upstream = await fetch(target, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; BGCC-Content-Desk/1.0; student project)' },
      cf: { cacheTtl: 600 },
    })
    if (!feedHost) {
      const type = upstream.headers.get('content-type') ?? ''
      const size = Number(upstream.headers.get('content-length') ?? 0)
      if (!PICTURE_TYPES.test(type) || size > 8e6) return new Response('only pages and images from this host', { status: 403, headers: cors })
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'content-type': upstream.headers.get('content-type') ?? 'text/xml' },
    })
  },
}
