import { generate } from './gemini'
import type { RawItem, SourceFamily, SourceRef } from './types'

const DAY = 86400000
const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export interface FeedDef {
  id: string
  name: string
  url: string
  family: SourceFamily
  direct?: boolean // sends CORS headers, so no relay needed
  global?: boolean // world news rather than Indian; the scan keeps a balance of both
}

export const FEEDS: FeedDef[] = [
  { id: 'mckinsey', name: 'McKinsey Insights', url: 'https://www.mckinsey.com/insights/rss', family: 'research', direct: true },
  { id: 'et', name: 'Economic Times', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', family: 'business_press' },
  { id: 'mint', name: 'Mint', url: 'https://www.livemint.com/rss/companies', family: 'business_press' },
  { id: 'bs', name: 'Business Standard', url: 'https://www.business-standard.com/rss/companies-101.rss', family: 'business_press' },
  { id: 'bl', name: 'BusinessLine', url: 'https://www.thehindubusinessline.com/companies/feeder/default.rss', family: 'business_press' },
  { id: 'inc42', name: 'Inc42', url: 'https://inc42.com/feed/', family: 'business_press' },
  { id: 'yourstory', name: 'YourStory', url: 'https://yourstory.com/feed', family: 'business_press' },
  { id: 'stratechery', name: 'Stratechery', url: 'https://stratechery.com/feed/', family: 'research' },
  {
    id: 'gnews',
    name: 'Google News · India business',
    url: 'https://news.google.com/rss/search?q=(startup+OR+acquisition+OR+IPO+OR+funding+OR+layoffs)+India+when:7d&hl=en-IN&gl=IN&ceid=IN:en',
    family: 'news',
  },
  { id: 'gtrends', name: 'Google Trends · India', url: 'https://trends.google.com/trending/rss?geo=IN', family: 'search' },
  // Global business news, so ideas come from the whole world and not just India.
  { id: 'gnews-world', name: 'Google News · World business', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en', family: 'news', global: true },
  { id: 'bbc', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', family: 'business_press', global: true },
  { id: 'cnbc', name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', family: 'business_press', global: true },
  { id: 'ft', name: 'Financial Times', url: 'https://www.ft.com/companies?format=rss', family: 'business_press', global: true },
  { id: 'guardian', name: 'The Guardian · Business', url: 'https://www.theguardian.com/business/rss', family: 'business_press', global: true },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', family: 'business_press', global: true },
]

/** Sources whose stories count as global when the scan balances Indian and world news. */
export const GLOBAL_SOURCES = new Set([...FEEDS.filter((f) => f.global).map((f) => f.name), 'Stratechery', 'McKinsey Insights', 'Hacker News'])

export const relayUrl = (relay: string, url: string) => {
  const base = relay || (import.meta.env.DEV ? '/relay' : '')
  return base ? `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}` : ''
}

export async function fetchFeed(feed: FeedDef, relay: string, maxAgeDays = 8): Promise<RawItem[]> {
  const url = feed.direct ? feed.url : relayUrl(relay, feed.url)
  if (!url) return []
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml')
  const nodes = [...doc.querySelectorAll('item, entry')].slice(0, 40)
  const cutoff = Date.now() - maxAgeDays * DAY
  return nodes
    .map((n) => {
      const pick = (sel: string) => n.querySelector(sel)?.textContent?.trim() ?? ''
      const link = n.querySelector('link')?.getAttribute('href') || pick('link')
      const title = pick('title')
      const date = pick('pubDate') || pick('published') || pick('updated')
      const traffic = n.getElementsByTagName('ht:approx_traffic')[0]?.textContent ?? ''
      const summary = (pick('description') || pick('summary')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 280)
      return {
        id: hash(link || title),
        title: traffic ? `${title} (${traffic} searches)` : title,
        summary,
        url: link,
        source: feed.name,
        family: feed.family,
        publishedAt: date ? new Date(date).toISOString() : undefined,
      } satisfies RawItem
    })
    .filter((i) => i.title && (!i.publishedAt || Date.parse(i.publishedAt) > cutoff))
}

// ---------- Hacker News (Algolia, CORS-enabled) ----------

const HN_QUERIES = ['startup', 'acquisition', 'IPO', 'layoffs', 'pricing', 'market share', 'India', 'regulation', 'consulting']

export async function fetchHackerNews(): Promise<RawItem[]> {
  const since = Math.floor((Date.now() - 7 * DAY) / 1000)
  const results = await Promise.allSettled(
    HN_QUERIES.map(async (q) => {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since},points>40`)}&hitsPerPage=12`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HN ${res.status}`)
      return (await res.json()).hits as any[]
    }),
  )
  const items = new Map<string, RawItem>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const h of r.value) {
      items.set(h.objectID, {
        id: `hn-${h.objectID}`,
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: 'Hacker News',
        family: 'community',
        publishedAt: h.created_at,
        points: h.points,
        comments: h.num_comments,
      })
    }
  }
  return [...items.values()]
}

/** Daily HN story counts for a term over the last 21 days (oldest first). */
export async function hnSeries(term: string): Promise<{ series: number[]; topPoints: number; topComments: number } | null> {
  const since = Math.floor((Date.now() - 21 * DAY) / 1000)
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${term}"`)}&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}&hitsPerPage=500`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const hits: any[] = (await res.json()).hits
    const series = new Array(21).fill(0)
    let topPoints = 0
    let topComments = 0
    for (const h of hits) {
      const age = Math.floor((Date.now() - h.created_at_i * 1000) / DAY)
      if (age >= 0 && age < 21) series[20 - age]++
      topPoints = Math.max(topPoints, h.points ?? 0)
      topComments = Math.max(topComments, h.num_comments ?? 0)
    }
    return { series, topPoints, topComments }
  } catch {
    return null
  }
}

// ---------- Wikipedia pageviews (CORS-enabled) ----------

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

/** Follows redirects and fuzzy-matches so "Zepto" resolves to "Zepto (company)". */
export async function resolveWikiTitle(title: string): Promise<string> {
  try {
    const q = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(title)}`
    const res = await fetch(q)
    if (!res.ok) return title
    const pages = (await res.json()).query?.pages ?? {}
    const first = Object.values(pages)[0] as { title?: string } | undefined
    return first?.title ?? title
  } catch {
    return title
  }
}

/** Daily pageviews for the last 21 days (oldest first), or null if the article isn't found. */
export async function wikiSeries(rawTitle: string): Promise<number[] | null> {
  const title = await resolveWikiTitle(rawTitle)
  const end = new Date(Date.now() - DAY)
  const start = new Date(end.getTime() - 20 * DAY)
  const article = encodeURIComponent(title.trim().replace(/ /g, '_'))
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${article}/daily/${ymd(start)}/${ymd(end)}`
  try {
    // No custom headers: Wikimedia rejects the CORS preflight they would trigger.
    const res = await fetch(url)
    if (!res.ok) return null
    const items: any[] = (await res.json()).items ?? []
    return items.length >= 10 ? items.map((i) => i.views as number) : null
  } catch {
    return null
  }
}

// ---------- Gemini grounded sweeps ----------

export const SWEEPS = [
  {
    id: 'india',
    label: 'India business & startups',
    prompt:
      'Indian business, startups, consumer internet, D2C, fintech, quick commerce, manufacturing, policy that moves markets, big corporate moves (M&A, IPOs, pricing changes, market entries/exits, layoffs, funding rounds)',
  },
  {
    id: 'global',
    label: 'Global strategy & industry',
    prompt:
      'global business strategy, big-tech and AI business models, consumer brands, energy, aviation, retail, sports business, notable corporate turnarounds or failures, and anything consulting firms (McKinsey, BCG, Bain) are publishing about',
  },
]

export async function groundedSweep(sweep: (typeof SWEEPS)[number], focus?: string): Promise<{ items: RawItem[]; sources: SourceRef[] }> {
  const today = new Date().toDateString()
  const r = await generate({
    role: 'scout',
    search: true,
    temperature: 0.4,
    prompt: `Today is ${today}. Use Google Search to find the 12 business stories from the last 7 days that people are discussing most in: ${sweep.prompt}.${
      focus ? `\nGive extra weight to: ${focus}.` : ''
    }
Prefer stories with concrete numbers, a strategic decision, or a debate. Skip politics, crime, disasters and celebrity gossip.

Return ONLY a JSON array. Each element:
{"headline": string, "summary": "2 factual sentences with the key numbers", "sector": string, "publisher": string, "date": "YYYY-MM-DD"}`,
    schema: {},
  })
  const list: any[] = Array.isArray(r.json) ? r.json : []
  const items: RawItem[] = list
    .filter((x) => x && x.headline)
    .map((x) => {
      // Attach the grounding chunks whose supported text overlaps this story.
      const refs = new Set<number>()
      for (const s of r.supports) {
        if (s.text && (s.text.includes(x.headline) || String(x.summary ?? '').includes(s.text.slice(0, 60)))) {
          s.chunks.forEach((c) => refs.add(c))
        }
      }
      const first = [...refs].map((i) => r.chunks[i]).find((c) => c?.url)
      return {
        id: hash(`${sweep.id}:${x.headline}`),
        title: String(x.headline),
        summary: String(x.summary ?? ''),
        url: first?.url ?? '',
        source: String(x.publisher ?? first?.title ?? 'Google Search'),
        family: 'news' as SourceFamily,
        publishedAt: x.date ? new Date(x.date).toISOString() : undefined,
      }
    })
  return { items, sources: r.sources }
}

// ---------- Google News search (fallback when Google Search grounding quota is spent) ----------

const STOP = new Set('the a an of and or in on for to with is are was were what how why who which latest current right now its it this that from by at as vs india indian'.split(' '))

/** Headlines for a query from Google News RSS, newest first. Needs the relay (Google News blocks browsers). */
export async function newsSearch(query: string, relay: string, days = 60): Promise<RawItem[]> {
  const run = async (q: string) => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-IN&gl=IN&ceid=IN:en`
    return fetchFeed({ id: 'gnews-q', name: 'Google News', url, family: 'news' }, relay, days + 1).catch(() => [] as RawItem[])
  }
  if (!relayUrl(relay, 'x')) throw new Error('Google Search quota is used up for today, and the news fallback needs the feed relay (Settings).')
  let items = await run(query)
  if (items.length < 5) {
    // RSS search is keyword-AND; retry with only the distinctive words.
    const words = query.replace(/[^\p{L}\p{N}\s.&-]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()))
    const short = words.slice(0, 4).join(' ')
    if (short && short !== query) items = [...items, ...(await run(short))]
  }
  const seen = new Set<string>()
  return items
    .filter((i) => !seen.has(i.title) && seen.add(i.title))
    .map((i) => {
      // Google News titles end with " - Publisher".
      const m = i.title.match(/^(.*) - ([^-]+)$/)
      return m ? { ...i, title: m[1].trim(), source: m[2].trim() } : i
    })
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 18)
}
