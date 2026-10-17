import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Slide } from '../slides/Slide'
import { snapshotter } from '../slides/snapshot'
import { brandFor } from './brand'
import { slideSource } from './factcheck'
import { generate } from './gemini'
import { getState } from './store'
import { CRITIQUE, lintTaste } from './taste'
import type { IdeaCard } from './types'

export interface Rendered {
  overflow: number[] // slides whose text still overflows at the smallest type size
  shrunk: number[] // slides whose type had to shrink noticeably to fit
  images: string[] // small JPEG data URLs, one per slide
  headLines: number[] // lines the headline wraps to, per slide (0 when it has none)
}

/** The cover is set as a poster and may take four lines; every other headline two. */
export const maxHeadLines = (card: IdeaCard, i: number) => (card.slides[i]?.kind === 'cover' ? 4 : 2)

/** Headlines that wrap past their limit, with a word target that would fit. */
export function longHeads(card: IdeaCard, r: Rendered) {
  return r.headLines.flatMap((lines, i) => {
    const max = maxHeadLines(card, i)
    if (lines <= max) return []
    const s = card.slides[i] as { title?: string; question?: string }
    const words = (s.title ?? s.question ?? '').split(/\s+/).filter(Boolean).length
    return [{ slide: i, lines, max, target: Math.max(3, Math.floor((words * max) / lines) - 1) }]
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frames = (n: number) => new Promise<void>((r) => { const step = (i: number) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1))); step(n) })

/** Renders the deck off-screen exactly as it exports, measures it, and takes small snapshots. */
export async function renderDeck(card: IdeaCard, opts: { images?: boolean } = {}): Promise<Rendered> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none;'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    const brand = brandFor(getState().brand, card)
    flushSync(() =>
      root.render(
        card.slides.map((s, i) =>
          createElement('div', { key: i, 'data-wrap': i }, createElement(Slide, { slide: s, index: i, total: card.slides.length, brand, style: card.style, source: slideSource(card, i) })),
        ),
      ),
    )
    await document.fonts.ready
    await Promise.all([...host.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
    // Diagrams draw asynchronously; give them up to 5 s.
    for (let t = 0; t < 50; t++) {
      const pending = [...host.querySelectorAll<HTMLElement>('[data-diagram]')].some((d) => d.dataset.ready !== '1')
      if (!pending) break
      await wait(100)
    }
    await frames(3)
    const bodies = [...host.querySelectorAll<HTMLElement>('[data-body]')]
    const overflow = bodies.flatMap((b, i) => (b.dataset.overflow === '1' ? [i] : []))
    const shrunk = bodies.flatMap((b, i) => (Number(b.dataset.k ?? 1) < 0.8 ? [i] : []))
    const headLines = [...host.querySelectorAll<HTMLElement>('[data-wrap]')].map((w) => {
      const h = w.querySelector<HTMLElement>('[data-head]')
      if (!h) return 0
      const lead = parseFloat(getComputedStyle(h).lineHeight)
      return lead > 0 ? Math.round(h.getBoundingClientRect().height / lead) : 0
    })
    const images: string[] = []
    if (opts.images) {
      const snap = await snapshotter(host)
      for (const w of host.querySelectorAll<HTMLElement>('[data-wrap]')) {
        images.push(await snap.jpeg(w.firstElementChild as HTMLElement, { pixelRatio: 0.42, quality: 0.82 }))
      }
    }
    return { overflow, shrunk, images, headLines }
  } finally {
    root.unmount()
    host.remove()
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    seen: { type: 'string' },
    design: { type: 'number' },
    readability: { type: 'number' },
    idea: { type: 'number' },
    content: { type: 'number' },
    score: { type: 'number' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: { slide: { type: 'number' }, problem: { type: 'string' }, fix: { type: 'string' } },
        required: ['slide', 'problem', 'fix'],
      },
    },
  },
  required: ['seen', 'design', 'readability', 'idea', 'content', 'score', 'slides'],
}

export interface DesignReview {
  score: number
  parts?: { design: number; readability: number; idea: number; content: number }
  seen?: string
  issues: { slide: number; problem: string; fix: string }[]
}

/** A visual designer looks at the rendered slides and names fixable problems. */
export async function reviewDesign(card: IdeaCard, r: Rendered): Promise<DesignReview> {
  const measured = [
    ...r.overflow.map((i) => `slide ${i + 1}: text overflows its area even at the smallest type size`),
    ...r.shrunk.filter((i) => !r.overflow.includes(i)).map((i) => `slide ${i + 1}: type had to shrink a lot to fit (too many words)`),
    ...longHeads(card, r).map((h) => `slide ${h.slide + 1}: headline wraps to ${h.lines} lines (limit ${h.max})`),
  ]
  const res = await generate({
    role: 'deep',
    temperature: 0.2,
    schema: REVIEW_SCHEMA,
    contents: [
      {
        role: 'user',
        parts: [
          ...r.images.map((url) => ({ inlineData: { mimeType: 'image/jpeg', data: url.split(',')[1] } })),
          {
            text: `You are a senior visual designer reviewing a ${card.slides.length}-slide carousel (1080×1350, for LinkedIn and Instagram) by a student consulting club. The images above are slides 1 to ${card.slides.length} in order.

${CRITIQUE}
${measured.length ? `\nMeasured by code:\n${measured.map((m) => `- ${m}`).join('\n')}\n` : ''}
seen: what you saw in one second on the cover. For each real problem a viewer would notice give one concrete content fix the writer can apply, most visible first, e.g. "cut to 3 points of ≤ 10 words", "turn the four numbers into a kpis slide", "shorten the title to ≤ 8 words", "switch to a bar chart of the 4 players". Name problems the way a designer would to a colleague; "could be more polished" is not a finding. Do not report problems you are unsure of. Slide numbers are 1-based. score: overall after the caps.`,
          },
        ],
      },
    ],
  })
  const j = res.json ?? {}
  const issues = ((j.slides ?? []) as any[])
    .filter((x) => x?.fix && Number.isFinite(Number(x.slide)))
    .map((x) => ({ slide: Number(x.slide) - 1, problem: String(x.problem ?? ''), fix: String(x.fix) }))
    .filter((x) => x.slide >= 0 && x.slide < card.slides.length)
  // Measured overflow is always fixed, even if the model missed it.
  for (const i of r.overflow) if (!issues.some((x) => x.slide === i)) issues.push({ slide: i, problem: 'Text overflows', fix: 'Cut the text on this slide by about a third' })
  for (const h of longHeads(card, r)) {
    issues.unshift({ slide: h.slide, problem: `Headline wraps to ${h.lines} lines`, fix: `Cut the headline to ≤ ${h.target} words so it fits on ${h.max} lines, keeping its number and names; move the rest into the body` })
  }
  // Copy tells found in code go first: they are certain, and cost nothing.
  issues.unshift(...lintTaste(card))
  const n = (k: string) => Math.min(10, Math.max(0, Number(j[k]) || 0))
  const parts = { design: n('design'), readability: n('readability'), idea: n('idea'), content: n('content') }
  const weighted = 0.4 * parts.design + 0.3 * parts.readability + 0.2 * parts.idea + 0.1 * parts.content
  // The model applies the caps to its overall score, so it may sit below the weighted sum but never above it.
  const score = Math.round(Math.min(n('score') || weighted, weighted || 10) * 10) / 10
  return { score, parts, seen: String(j.seen ?? ''), issues }
}

export const designInstruction = (rv: DesignReview) =>
  rv.issues.length ? `DESIGN FIXES: ${rv.issues.map((x) => `${x.slide < 0 ? 'captions' : `slide ${x.slide + 1}`}: ${x.fix}`).join('; ')}.` : ''
