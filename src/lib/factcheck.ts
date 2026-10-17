import { generate } from './gemini'
import type { FactCheck, IdeaCard, SlideSpec } from './types'

// A number worth checking: money, percentages, multiples, big counts. "3 questions" and slide numbers are not.
const NUM_RE = /(?<![A-Za-z\d])(?:₹|\$|rs\.?\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|×|x\b|crore|cr\b|lakh|bn\b|billion|million|mn\b|trillion|k\b|gw\b|mw\b|users|stores|orders))?/gi

const canon = (s: string) => s.replace(/[^\d.]/g, '').replace(/\.0+$/, '').replace(/^0+(?=\d)/, '')

interface Claim {
  id: string
  slide: number
  number: string
  text: string // the sentence or field the number sits in
  kind: 'fact' | 'computed' | 'assumption'
}

function interesting(token: string) {
  const digits = canon(token)
  if (!digits) return false
  const n = parseFloat(digits)
  const unit = /[%×₹$]|x\b|crore|cr\b|lakh|bn|billion|million|mn|trillion|k\b/i.test(token)
  if (/^(19|20)\d\d$/.test(digits) && !unit) return false // years: checked as part of the sentence, not alone
  return unit || n >= 10
}

// Not slide copy: the layout label, the series label, and the picture (its search, its data URL and credit).
const SKIP = new Set(['kind', 'kicker', 'picture', 'image'])

function textsOf(slide: SlideSpec): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => !SKIP.has(k) && walk(x))
  }
  if (slide.kind === 'chart') {
    out.push(slide.title, ...(slide.note ? [slide.note] : []))
    for (const d of slide.data) out.push(`${d.label}: ${d.value}${slide.unit ? ` ${slide.unit}` : ''}`)
  } else walk(slide)
  return out
}

/** Every checkable number on the slides and in both captions. */
export function extractClaims(card: Pick<IdeaCard, 'slides' | 'caption' | 'captionInstagram'>): Claim[] {
  const claims: Claim[] = []
  const add = (slide: number, text: string, kind: Claim['kind']) => {
    for (const m of text.matchAll(NUM_RE)) {
      const token = m[0].trim().replace(/,$/, '')
      if (!interesting(token)) continue
      if (claims.some((c) => c.slide === slide && canon(c.number) === canon(token))) continue
      claims.push({ id: `c${claims.length + 1}`, slide, number: token, text: text.length > 220 ? text.slice(Math.max(0, m.index! - 100), m.index! + 120) : text, kind })
    }
  }
  card.slides.forEach((s, i) => {
    if (s.kind === 'tree') return // inputs are labelled assumptions; the answer is computed
    if (s.kind === 'stat' && s.linked) {
      claims.push({ id: `c${claims.length + 1}`, slide: i, number: s.value, text: s.label, kind: 'computed' })
      return
    }
    textsOf(s).forEach((t) => add(i, t, 'fact'))
  })
  add(-1, card.caption, 'fact')
  if (card.captionInstagram) add(-1, card.captionInstagram, 'fact')
  return claims
}

/** Positions of every number in the brief, with the citation that follows it on the same line. */
function indexBrief(brief: string) {
  const out: { value: string; cite?: number; at: number }[] = []
  for (const m of brief.matchAll(NUM_RE)) {
    const value = canon(m[0])
    if (!value) continue
    const end = brief.indexOf('\n', m.index!)
    const rest = brief.slice(m.index! + m[0].length, end < 0 ? undefined : end).slice(0, 400)
    const cite = rest.match(/\[(\d+)/)?.[1]
    out.push({ value, cite: cite ? Number(cite) : undefined, at: m.index! })
  }
  return out
}

/** Code-only pass: a number is sourced when the brief states the same figure. Free and instant. */
export function matchClaims(claims: Claim[], brief: string, sourceCount: number): { checks: FactCheck[]; unmatched: Claim[] } {
  const index = indexBrief(brief)
  const checks: FactCheck[] = []
  const unmatched: Claim[] = []
  for (const c of claims) {
    if (c.kind === 'computed') {
      checks.push({ slide: c.slide, claim: c.number, status: 'computed', note: 'Calculated in code from the assumption tree' })
      continue
    }
    const v = canon(c.number)
    const hit = index.find((x) => x.value === v && x.cite) ?? index.find((x) => x.value === v)
    if (hit) checks.push({ slide: c.slide, claim: c.number, status: 'sourced', source: hit.cite && hit.cite <= sourceCount ? hit.cite : undefined })
    else unmatched.push(c)
  }
  return { checks, unmatched }
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['supported', 'derived', 'unsupported'] },
          evidence: { type: 'string' },
          correction: { type: 'string' },
        },
        required: ['id', 'status'],
      },
    },
  },
  required: ['results'],
}

/** Model pass for numbers the code couldn't match: rounded, converted, computed, or made up. */
export async function verifyClaims(claims: Claim[], brief: string): Promise<FactCheck[]> {
  if (!claims.length) return []
  const r = await generate({
    role: 'scout',
    temperature: 0,
    schema: VERIFY_SCHEMA,
    prompt: `You are a fact-checker for a student consulting club's social posts. Check each claim against the RESEARCH BRIEF, which is the only evidence.

For each claim:
- "supported": the brief states this figure, allowing for rounding (₹52,878 crore → ₹52,900 crore), unit changes (₹1 lakh crore = ₹1 trillion) or a different but equivalent wording. evidence = the brief's exact words.
- "derived": correctly calculated from figures in the brief (a ratio, difference, share or growth rate). evidence = the calculation.
- "unsupported": not in the brief, a different period or entity than the brief says, or contradicted by it. correction = the right figure from the brief, or "remove" if the brief has nothing.

Be strict: a figure that is plausible but absent from the brief is unsupported.

CLAIMS:
${claims.map((c) => `${c.id} (${c.slide < 0 ? 'caption' : `slide ${c.slide + 1}`}): "${c.number}" in: ${c.text}`).join('\n')}

RESEARCH BRIEF:
${brief.slice(0, 16000)}`,
  })
  const res = new Map<string, any>(((r.json?.results ?? []) as any[]).map((x) => [x.id, x]))
  return claims.map((c) => {
    const x = res.get(c.id)
    const status: FactCheck['status'] = x?.status === 'supported' ? 'sourced' : x?.status === 'derived' ? 'derived' : 'unsupported'
    return { slide: c.slide, claim: c.number, status, note: (status === 'unsupported' ? x?.correction : x?.evidence) || undefined }
  })
}

/** Instruction for the reviser to correct or drop unsupported figures. */
export function fixInstruction(checks: FactCheck[]) {
  const bad = checks.filter((c) => c.status === 'unsupported')
  if (!bad.length) return ''
  return `FACT FIXES (the research brief does not support these figures): ${bad
    .map((c) => `${c.slide < 0 ? 'caption' : `slide ${c.slide + 1}`}: "${c.claim}"${c.note && c.note !== 'remove' ? ` → use: ${c.note}` : ' → remove it or rewrite without a number'}`)
    .join('; ')}.`
}

/** Full check: code match first, the model only for what's left. */
export async function factCheck(card: IdeaCard): Promise<FactCheck[]> {
  const brief = card.brief ?? ''
  const { checks, unmatched } = matchClaims(extractClaims(card), brief, card.sources.length)
  let verified: FactCheck[] = []
  try {
    verified = await verifyClaims(unmatched, brief)
  } catch {
    verified = unmatched.map((c) => ({ slide: c.slide, claim: c.number, status: 'unsupported' as const, note: 'Could not verify (quota)' }))
  }
  return order([...checks, ...verified])
}

/** After a revision: re-match in code and keep earlier model verdicts for figures that didn't change. */
export function recheck(card: IdeaCard, previous: FactCheck[]): FactCheck[] {
  const { checks, unmatched } = matchClaims(extractClaims(card), card.brief ?? '', card.sources.length)
  const kept = unmatched.map((c) => {
    const prev = previous.find((p) => p.claim === c.number && p.status !== 'sourced')
    return prev ? { ...prev, slide: c.slide } : { slide: c.slide, claim: c.number, status: 'unsupported' as const, note: 'Not found in the research brief' }
  })
  return order([...checks, ...kept])
}

const order = (c: FactCheck[]) => c.sort((a, b) => (a.slide < 0 ? 99 : a.slide) - (b.slide < 0 ? 99 : b.slide))

// Social posts can back a number but aren't a source to credit on a slide. Grounding links are Google redirects
// whose title is the publisher's domain, so check the title too.
const SOCIAL = /\b(instagram|facebook|twitter|linkedin|youtube|reddit|threads|tiktok)\b|^x\.com$/i

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The source to credit in a slide's footer: the first non-social cited source behind its numbers. */
export function slideSource(card: Pick<IdeaCard, 'checks' | 'sources'>, index: number): string | undefined {
  const s = (card.checks ?? [])
    .filter((c) => c.slide === index && c.source)
    .map((c) => card.sources[c.source! - 1])
    .find((x) => x && !SOCIAL.test(hostOf(x.url)) && !SOCIAL.test(x.source ?? x.title))
  if (!s) return undefined
  const host = hostOf(s.url)
  // News fallback items carry the publisher; redirects don't name it in the URL.
  return !host || host.includes('vertexaisearch') || host.includes('google.com') ? (s.source ?? s.title) : host
}
