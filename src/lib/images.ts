// Real pictures for slides, the way taste-skill's assets step finds them (github.com/Leonxlnx/taste-skill):
// search several open collections for the subject, look at the candidates, keep one with its credit.
// Here the lead photos of the research's own news articles and Bing's image results join Wikipedia,
// Wikimedia Commons and Openverse. Licences are not checked: this is an internal brainstorming desk.
import { generate } from './gemini'
import { relayUrl } from './sources'
import { getState } from './store'
import type { IdeaCard, SlideImage, SlideSpec, SourceRef } from './types'

/** Layouts a photo sits behind (darkened), and layouts that take a photo band above their content. */
export const BACKDROP_KINDS = new Set<SlideSpec['kind']>(['cover', 'statement', 'stat', 'quote', 'closing'])
export const PANEL_KINDS = new Set<SlideSpec['kind']>(['bullets', 'steps', 'kpis'])
export const canHavePicture = (k: SlideSpec['kind']) => BACKDROP_KINDS.has(k) || PANEL_KINDS.has(k)

interface Candidate {
  url: string // full-size image
  thumb: string // small version for the model to look at
  credit: string
  page?: string
  from: 'news' | 'web' | 'wikipedia' | 'commons' | 'openverse'
  width?: number
}

const TIMEOUT = 9000
const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const getJson = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ---------- sources ----------

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Bing's image results for the subject (through the relay): the widest net, usually press photos. */
async function web(q: string, relay: string): Promise<Candidate[]> {
  const page = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1`
  const url = relayUrl(relay, page)
  if (!url) return []
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
    const html = r.ok ? await r.text() : ''
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const out = [...doc.querySelectorAll<HTMLElement>('a.iusc[m]')].flatMap((a) => {
      try {
        const m = JSON.parse(a.getAttribute('m')!)
        return m.murl && m.turl ? [{ url: m.murl as string, thumb: m.turl as string, credit: `Photo: ${host(m.purl ?? m.murl)}`, page: m.purl, from: 'web' as const }] : []
      } catch {
        return []
      }
    })
    if (out.length) return out.slice(0, 5)
  }
  return []
}

/** Wikipedia's lead image for the best-matching articles: people, companies, places and products. */
async function wikipedia(q: string): Promise<Candidate[]> {
  const j = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&gsrsearch=${encodeURIComponent(q)}&prop=pageimages|info&inprop=url&piprop=thumbnail|original&pithumbsize=480`,
  )
  // Image URLs come back with tracking parameters; drop them before looking at the file type.
  const bare = (u?: string) => u?.split('?')[0]
  return Object.values<any>(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .filter((p) => p.original?.source && !/\.svg$/i.test(bare(p.original.source)!))
    .map((p) => ({ url: widen(bare(p.original.source)!, p.original.width), thumb: bare(p.thumbnail?.source) ?? bare(p.original.source)!, credit: `Wikipedia: ${p.title}`, page: p.fullurl, from: 'wikipedia' as const, width: p.original.width }))
    .slice(0, 2)
}

/** Wikimedia Commons files: photographs of places, events, products, people. */
async function commons(q: string): Promise<Candidate[]> {
  const j = await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=5&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1400`,
  )
  return Object.values<any>(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((p) => p.imageinfo?.[0])
    .filter((ii) => ii?.thumburl && (ii.width ?? 0) >= 800)
    .map((ii) => {
      const m = ii.extmetadata ?? {}
      const who = strip(m.Artist?.value ?? '').slice(0, 60)
      return { url: ii.thumburl, thumb: ii.thumburl.replace(/\/\d+px-/, '/400px-'), credit: [who, m.LicenseShortName?.value, 'Wikimedia Commons'].filter(Boolean).join(' · '), page: ii.descriptionurl, from: 'commons' as const, width: ii.width }
    })
}

/** Openverse: one index over Flickr, museums and libraries. */
async function openverse(q: string): Promise<Candidate[]> {
  const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=5&mature=false`)
  return (j.results ?? [])
    .filter((r: any) => (r.width ?? 0) >= 800)
    .map((r: any) => ({
      url: `https://api.openverse.org/v1/images/${r.id}/thumb/?full_size=true`,
      thumb: `https://api.openverse.org/v1/images/${r.id}/thumb/`,
      credit: [r.creator, r.license && `CC ${String(r.license).toUpperCase()}`, r.source].filter(Boolean).join(' · '),
      page: r.foreign_landing_url,
      from: 'openverse' as const,
      width: r.width,
    }))
}

/** The lead photo (og:image) of each news article behind the research. Needs the feed relay. */
async function newsPhotos(sources: SourceRef[], relay: string): Promise<Candidate[]> {
  const urls = sources.map((s) => s.url).filter((u) => /^https?:/.test(u) && !/(twitter|x|linkedin|reddit|youtube|instagram|facebook)\.com/.test(u)).slice(0, 10)
  if (!relayUrl(relay, 'https://example.com')) return []
  const pages = await Promise.allSettled(
    urls.map(async (u) => {
      const r = await fetch(relayUrl(relay, u), { signal: AbortSignal.timeout(TIMEOUT) })
      if (!r.ok) return null
      const html = (await r.text()).slice(0, 400_000)
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const meta = (k: string) => doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute('content') ?? ''
      const img = meta('og:image') || meta('twitter:image')
      if (!img) return null
      // Some sites put an SEO keyword list in og:site_name; the domain reads better then.
      const named = meta('og:site_name').trim()
      const site = named && named.length <= 28 && !/[|,]/.test(named) ? named : new URL(meta('og:url') || u).hostname.replace(/^www\./, '')
      return { url: new URL(img, meta('og:url') || u).href, thumb: '', credit: `Photo: ${site}`, page: meta('og:url') || u, from: 'news' as const }
    }),
  )
  const seen = new Set<string>()
  return pages.flatMap((p) => (p.status === 'fulfilled' && p.value && !seen.has(p.value.url) && seen.add(p.value.url) ? [p.value] : []))
}

/** Wikipedia's originals can be huge; ask for a 1600px rendition when the original is wider. */
function widen(src: string, width?: number) {
  if (!width || width <= 1600 || !src.includes('/commons/')) return src
  const name = src.split('/').pop()!
  return `${src.replace('/commons/', '/commons/thumb/')}/1600px-${name}`
}

// ---------- pixels ----------

/** Fetches an image (directly when the host allows it, else through the relay) and re-encodes it as a JPEG data URL. */
async function toDataUrl(url: string, maxSide: number, quality: number): Promise<{ src: string; w: number; h: number }> {
  const relay = getState().settings.relay
  let blob: Blob | null = null
  for (const u of [url, relayUrl(relay, url)].filter(Boolean)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT) })
      if (r.ok && (r.headers.get('content-type') ?? 'image/').startsWith('image/')) {
        blob = await r.blob()
        break
      }
    } catch {
      // try the relay next
    }
  }
  if (!blob) throw new Error('image unavailable')
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * s)
  canvas.height = Math.round(bmp.height * s)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const out = { src: canvas.toDataURL('image/jpeg', quality), w: bmp.width, h: bmp.height }
  bmp.close()
  return out
}

// ---------- pick ----------

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: { type: 'object', properties: { slide: { type: 'number' }, candidate: { type: 'string' }, why: { type: 'string' } }, required: ['slide', 'candidate'] },
    },
  },
  required: ['picks'],
}

export interface PictureResult {
  found: number
  wanted: number
  notes?: string[] // per slide: what was picked and why
}

/**
 * Finds a picture for every slide that asks for one (`picture`) and has none yet. One vision call chooses among
 * all candidates; slides with no fitting candidate are left without a picture.
 */
export async function findPictures(card: IdeaCard, signal?: AbortSignal, exclude: string[] = []): Promise<{ card: IdeaCard } & PictureResult> {
  const wanted = card.slides.flatMap((s, i) => (s.picture?.trim() && !s.image && canHavePicture(s.kind) ? [{ i, q: s.picture.trim() }] : []))
  if (!wanted.length) return { card, found: 0, wanted: 0 }
  const relay = getState().settings.relay
  const settle = async <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])

  // Search everything at once: news photos are shared by every slide, the collections are searched per subject.
  const [news, ...perSlide] = await Promise.all([
    settle(newsPhotos(card.sources, relay)),
    ...wanted.map(async ({ q }) =>
      (await Promise.all([settle(web(q, relay)), settle(wikipedia(q)), settle(commons(q).then((c) => c.slice(0, 2))), settle(openverse(q).then((c) => c.slice(0, 2)))])).flat(),
    ),
  ])
  const pool: Candidate[] = []
  const ids = new Map<string, number>()
  const add = (c: Candidate) => {
    if (!ids.has(c.url)) ids.set(c.url, pool.push(c) - 1)
    return ids.get(c.url)!
  }
  const fresh = (c: Candidate) => !exclude.includes(c.url)
  news.filter(fresh).slice(0, 8).forEach(add)
  const bySlide = perSlide.map((cs) => cs.filter(fresh).slice(0, 9).map(add))

  // Small thumbnails for the model; candidates that fail to load or are too small drop out here.
  const thumbs = await Promise.all(
    pool.map(async (c) => {
      try {
        const t = await toDataUrl(c.thumb || c.url, 320, 0.7)
        // News photos load at full size here, so their real width is known; web thumbnails are small by design.
        if (c.from === 'news' && t.w < 600) return null
        return t.src
      } catch {
        return null
      }
    }),
  )
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const shown = pool.map((_, n) => n).filter((n) => thumbs[n])
  if (!shown.length) return { card, found: 0, wanted: wanted.length }

  const label = (n: number) => `c${n + 1}`
  const res = await generate({
    role: 'vision',
    temperature: 0.1,
    schema: PICK_SCHEMA,
    signal,
    contents: [
      {
        role: 'user',
        parts: [
          ...shown.flatMap((n) => [{ text: `${label(n)} (${pool[n].from}, ${pool[n].credit})` }, { inlineData: { mimeType: 'image/jpeg', data: thumbs[n]!.split(',')[1] } }]),
          {
            text: `You are the photo editor for a carousel post titled "${card.title}" by a student consulting club. Above are candidate pictures, each labelled c1, c2, …

Pick one picture for each slide below, or "none". A good pick is a real photograph that shows the slide's subject itself: the named company's stores, riders, app or products; the named person; the place or event. It will fill a large area with text over or under it.
Reject: logos or wordmarks on a plain background, screenshots of text or articles, charts, collages with captions, heavy watermarks, blurry or tiny images, and anything about a different company or person. Generic stock that merely fits the theme is acceptable only for the cover and only if nothing specific exists. Never use one picture for two slides. Any candidate may be used for any slide; news photos come from the articles behind this post and web photos from an image search, and these are often the best match. Prefer a photo at least 800 pixels wide where two are equally good.

${wanted.map((w, k) => `slide ${w.i + 1}: ${w.q}${bySlide[k].length ? ` (searched for it: ${bySlide[k].filter((n) => thumbs[n]).map(label).join(', ')})` : ''}`).join('\n')}

Return picks with slide (1-based), candidate (a label like "c4", or "none"), and why in a few words.`,
          },
        ],
      },
    ],
  })

  const all = (res.json?.picks ?? []) as any[]
  const notes = all.map((p) => {
    const n = Number(String(p.candidate).slice(1)) - 1
    return `slide ${p.slide} "${wanted.find((w) => w.i === p.slide - 1)?.q}": ${pool[n] ? `${p.candidate} (${pool[n].credit})` : 'none'}, ${p.why ?? ''}`
  })
  const picks = all.filter((p) => /^c\d+$/.test(String(p.candidate)))
  const used = new Set<number>()
  const slides = [...card.slides]
  let found = 0
  await Promise.all(
    picks.map(async (p) => {
      const i = Number(p.slide) - 1
      const n = Number(String(p.candidate).slice(1)) - 1
      const want = wanted.find((w) => w.i === i)
      if (!want || !thumbs[n] || used.has(n)) return
      used.add(n)
      const c = pool[n]
      try {
        const full = await toDataUrl(c.url, 1500, 0.84)
        const image: SlideImage = { src: full.src, credit: c.credit, page: c.page, origin: c.url, query: want.q }
        slides[i] = { ...slides[i], image }
        found++
      } catch {
        // The full-size file failed where its thumbnail worked; leave the slide without a picture.
      }
    }),
  )
  return { card: { ...card, slides }, found, wanted: wanted.length, notes: [`${shown.length} candidates (${news.length} news photos)`, ...notes] }
}

/** Searches again for one slide (the editor's "Find another" or a new subject), skipping the picture it has now. */
export async function replacePicture(card: IdeaCard, index: number, query?: string): Promise<IdeaCard> {
  const s = card.slides[index]
  const prev = s.image
  const slides = card.slides.map((x, i) => (i === index ? { ...x, picture: query?.trim() || x.picture || prev?.query, image: undefined } : x))
  // Only this slide is searched: the others already have their picture or don't want one.
  const solo = { ...card, slides: slides.map((x, i) => (i === index ? x : { ...x, picture: x.image ? x.picture : undefined })) }
  const { card: out } = await findPictures(solo, undefined, prev?.origin ? [prev.origin] : [])
  const got = out.slides[index].image
  if (!got) throw new Error(`No other fitting picture found for "${slides[index].picture}". Try different words.`)
  return { ...card, slides: card.slides.map((x, i) => (i === index ? { ...x, picture: slides[index].picture, image: got } : x)) }
}

/** An uploaded or pasted picture, from the editor. */
export async function pictureFromFile(file: File, query = 'uploaded'): Promise<SlideImage> {
  const url = URL.createObjectURL(file)
  try {
    const { src } = await toDataUrl(url, 1500, 0.84)
    return { src, credit: '', query }
  } finally {
    URL.revokeObjectURL(url)
  }
}
