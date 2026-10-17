import { brandSystemPrompt } from './brand'
import { webFacts } from './research'
import { generate } from './gemini'
import { FORMATS, HOURS_BY_COMPLEXITY } from './scoring'
import { TASTE_RULES } from './taste'
import type { BrandProfile, Critique, FormatId, IdeaCard, SlideSpec, SourceRef, Topic, TreeNode } from './types'

export { uid } from './id'
import { uid } from './id'

// ---------- numbers ----------

export function formatIndian(n: number, unit = ''): string {
  if (!Number.isFinite(n)) return '—'
  if (unit === '%') return `${+(n * 100).toFixed(n * 100 >= 10 ? 0 : 1)}%`
  const abs = Math.abs(n)
  const round = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-IN') : x.toFixed(x >= 10 ? 1 : 2).replace(/\.?0+$/, ''))
  let s: string
  if (abs >= 1e7) s = `${round(n / 1e7)} crore`
  else if (abs >= 1e5) s = `${round(n / 1e5)} lakh`
  else if (abs >= 100) s = Math.round(n).toLocaleString('en-IN')
  else s = round(n)
  if (!unit) return s
  return unit.startsWith('₹') ? `₹${s}${unit.slice(1)}` : `${s} ${unit}`
}

/** Fills in every non-input node by multiplying or summing its children. */
export function computeTree(node: TreeNode): number {
  if (node.op === 'input' || !node.children?.length) return node.value ?? 0
  const vals = node.children.map(computeTree)
  node.value = node.op === 'sum' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a * b, 1)
  return node.value
}

type FlatNode = { id: string; parent?: string; label: string; op: TreeNode['op']; value?: number; unit?: string }

function buildTree(nodes: FlatNode[]): TreeNode | null {
  if (!nodes?.length) return null
  const byId = new Map(nodes.map((n) => [n.id, { label: n.label, op: n.op, value: n.value, unit: n.unit, children: [] as TreeNode[] }]))
  let root: TreeNode | null = null
  for (const n of nodes) {
    const node = byId.get(n.id)!
    const parent = n.parent ? byId.get(n.parent) : undefined
    if (parent) parent.children.push(node)
    else if (!root) root = node
  }
  const prune = (t: TreeNode) => {
    if (!t.children?.length) {
      delete t.children
      if (t.op !== 'input') t.op = 'input'
    } else t.children.forEach(prune)
  }
  if (root) {
    prune(root)
    computeTree(root)
  }
  return root
}

// ---------- schemas ----------

const str = { type: 'string' }
const strArr = { type: 'array', items: str }

const num = { type: 'number' }
const SLIDE_KINDS = ['cover', 'statement', 'bullets', 'stat', 'kpis', 'chart', 'compare', 'timeline', 'quote', 'table', 'ranked', 'diagram', 'steps', 'matrix', 'tree', 'poll', 'closing']
const side = { type: 'object', properties: { name: str, stat: str, statLabel: str, points: strArr }, required: ['name', 'points'] }

export const SLIDE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: SLIDE_KINDS },
    kicker: str,
    title: str,
    subtitle: str,
    body: str,
    points: strArr,
    value: str,
    label: str,
    context: str,
    xAxis: str,
    yAxis: str,
    quadrants: { type: 'array', items: { type: 'object', properties: { title: str, body: str }, required: ['title', 'body'] } },
    steps: { type: 'array', items: { type: 'object', properties: { title: str, body: str }, required: ['title', 'body'] } },
    question: str,
    options: strArr,
    cta: str,
    note: str,
    chart: { type: 'string', enum: ['bar', 'column', 'line'] },
    data: { type: 'array', items: { type: 'object', properties: { label: str, value: num }, required: ['label', 'value'] } },
    unit: str,
    highlight: num,
    items: { type: 'array', items: { type: 'object', properties: { value: str, label: str, name: str, note: str, desc: str } } },
    left: side,
    right: side,
    verdict: str,
    events: { type: 'array', items: { type: 'object', properties: { date: str, text: str }, required: ['date', 'text'] } },
    quote: str,
    picture: str,
    who: str,
    role: str,
    columns: strArr,
    rows: { type: 'array', items: strArr },
    shape: { type: 'string', enum: ['pyramid', 'funnel', 'cycle', 'roadmap', 'swot'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str,
          parent: str,
          label: str,
          op: { type: 'string', enum: ['multiply', 'sum', 'input'] },
          value: num,
          unit: str,
        },
        required: ['id', 'label', 'op'],
      },
    },
  },
  required: ['kind'],
}

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    angle: str,
    trendRelevance: str,
    audienceRelevance: str,
    hook: str,
    hookVariants: strArr,
    // Planned before the slides so the model commits to a story and a layout per beat.
    storyboard: { type: 'array', items: { type: 'object', properties: { beat: str, kind: { type: 'string', enum: SLIDE_KINDS } }, required: ['beat', 'kind'] } },
    slides: { type: 'array', items: SLIDE_SCHEMA },
    caption: str,
    captionInstagram: str,
    hashtags: strArr,
    altText: str,
    needs: strArr,
  },
  required: ['title', 'angle', 'trendRelevance', 'audienceRelevance', 'hook', 'hookVariants', 'storyboard', 'slides', 'caption', 'captionInstagram', 'hashtags', 'altText'],
}

/** Every layout the renderer knows, with its fields and when to use it. Shared by the writer and reviser. */
export const LAYOUT_MENU = `LAYOUTS (fields in brackets):
- cover [kicker 1–3 words, title = the hook as a headline, subtitle ≤ 20 words]
- statement [title, body ≤ 35 words]: context, or one idea that needs a sentence.
- bullets [title, points: 3–4, each ≤ 14 words]: reasons or arguments. At most twice per deck.
- stat [value, label ≤ 8 words, context ≤ 30 words]: one striking number.
- kpis [title, items: 2–4 of {value, label ≤ 6 words}]: several headline numbers side by side.
- chart [title, chart "bar" | "column" | "line", data: 3–8 of {label ≤ 3 words, value: a plain number}, unit ("₹ cr", "%", "lakh", "$ bn"…), highlight: index of the bar to emphasise, note: source and period]: bar compares companies or categories; column shows values across periods; line shows a trend over 5+ periods. Every value must come from the brief.
- compare [title, left and right: {name, stat?, statLabel?, points: 2–3 short}, verdict ≤ 20 words]: X vs Y.
- timeline [title, events: 3–6 of {date ≤ 10 chars, text ≤ 14 words}]: how a story unfolded.
- quote [quote ≤ 30 words, verbatim from the brief, who, role]: a real person's words.
- table [title, columns: 2–4 headers, rows: 3–6 rows of short strings, highlight: row index]: several players on several metrics.
- ranked [title, items: 3–6 of {name, value?, note ≤ 10 words}]: a top-N list.
- diagram [title, shape "pyramid" | "funnel" | "cycle" | "roadmap" | "swot", items: 3–6 of {label ≤ 4 words, desc ≤ 10 words}, note?]: a framework drawn as a picture. pyramid = layers or hierarchy of needs; funnel = conversion stages; cycle = a loop or flywheel; roadmap = phases in order; swot = exactly 4 items labelled Strengths, Weaknesses, Opportunities, Threats, each desc = 2 short points separated by ";".
- steps [title, steps: 3–5 of {title, body ≤ 20 words}]: a process explained in words.
- matrix [title, xAxis, yAxis, quadrants: 4 of {title, body ≤ 18 words}]: a 2×2.
- tree: guesstimates only (see the recipe). Never for a qualitative issue tree; use diagram or steps for that.
- poll [question, options: 2–4]
- closing [title = the takeaway, cta ≤ 25 words]`

const DESIGN_RULES = `DESIGN RULES:
1. First write the storyboard: one beat per slide (what the reader learns) and the layout that shows it best. Then write the slides to match it.
2. Show, don't list: whenever the brief has 3+ comparable numbers, use chart, kpis or table, never a bullet list of numbers. A "who's winning" beat is a chart, ranked or compare; a "how it happened" beat is a timeline.
3. Never put two text-only slides (statement, bullets, steps) next to each other. Aim for at least half the body slides to be visual (stat, kpis, chart, compare, timeline, quote, table, ranked, diagram, matrix, tree).
4. Slides are read in 3 seconds: keep to the word limits. Action titles ≤ 12 words.
5. Only use numbers, names and quotes that appear in the research brief. Copy numbers exactly as the brief states them, with the period. Prefer the newest figures; never present an old report's number as current.
6. Never write "Source:" or a publication name and date in slide text; the footer credits sources automatically. Table headers are plain words (no "(logo)" or notes).
7. picture (optional, on cover, statement, stat, quote, closing, bullets, steps, kpis): a real photograph is searched for and placed on the slide (behind the text on cover, statement, stat, quote and closing; as a band above the content on bullets, steps and kpis, which then hold less text). Leave it empty where no picture is wanted. Give it where a real picture makes the slide land faster: the named company's stores, riders, app or product; the named person; the place or the event. Write it as a short image-search query naming that subject, e.g. "Blinkit delivery rider Delhi", "Deepinder Goyal", "Zepto dark store". The cover nearly always gets one; add one or two more only where they earn it. Never for an abstract idea ("growth", "strategy", "profitability"), and never on chart, table, compare, timeline, diagram, matrix, tree, ranked or poll slides.`

// Story beats per format; the writer picks a layout for each beat from LAYOUT_MENU.
const FORMAT_RECIPES: Record<FormatId, string> = {
  guesstimate: `cover → the exact question and its scope (geography, period, unit) → tree (assumption tree; leaf nodes are op "input" with a numeric value, parents are "multiply" or "sum"; 6–10 nodes; the root has no parent; give every node a unit; write shares and rates as decimals between 0 and 1 with unit "%"; use "₹" as the unit for rupee amounts) → why the key assumptions hold → stat (value MUST be the literal text "{{ANSWER}}"; the app computes it from the tree) → sanity check against a real published figure (kpis or compare works well) → poll (is the estimate high or low?) → closing.`,
  case_breakdown: `cover → situation with the key numbers → complication: the decision the company faces → how a consultant would structure it (diagram, matrix or steps) → 2–3 options with trade-offs (compare or table) → recommendation and the one metric to watch → poll ("What would you recommend?") → closing.`,
  framework: `cover → why this week's news is a perfect example (with a number) → the framework drawn (diagram or matrix) → the framework applied to the example, part by part → how to use it in a case interview → closing.`,
  industry_analysis: `cover → the headline number for the sector (stat or kpis) → value chain or structure (diagram or steps) → who is winning and by how much (chart, ranked or table) → where the profit pools are → what changes in the next 2–3 years (timeline or roadmap diagram) → closing.`,
  interactive: `cover → context in 2 sentences with one number → the case for side A vs side B (compare) → the evidence (kpis, chart or quote) → poll (2–4 options) → closing (ask for reasoning in the comments).`,
  quick_take: `cover → what happened, with the key number (stat or kpis) → how it unfolded or how it compares (timeline, chart or compare) → why it matters (3 points) → 3 questions a consultant would ask next → closing.`,
}

// ---------- card writer ----------

export interface CardInput {
  topic: Pick<Topic, 'label' | 'summary' | 'sector'> & Partial<Topic>
  format: FormatId
  alternates?: FormatId[]
  routingReason?: string
  brief: string
  sources: SourceRef[]
  extraDirection?: string
  origin: IdeaCard['origin']
}

export async function writeCard(input: CardInput, brand: BrandProfile, signal?: AbortSignal): Promise<IdeaCard> {
  const fmt = FORMATS[input.format]
  const r = await generate({
    role: 'writer',
    system: brandSystemPrompt(brand),
    schema: CARD_SCHEMA,
    temperature: 0.8,
    signal,
    prompt: `Turn this trend into a ready-to-design post for BGCC.

TOPIC: ${input.topic.label}
SECTOR: ${input.topic.sector}
SUMMARY: ${input.topic.summary}
FORMAT: ${fmt.label} (${fmt.blurb})
WHY THIS FORMAT: ${input.routingReason ?? 'chosen by the editor'}
${input.extraDirection ? `EDITOR'S DIRECTION: ${input.extraDirection}\n` : ''}
RESEARCH BRIEF (facts you may use; do not invent other numbers):
${input.brief}

SOURCES:
${input.sources.map((s, i) => `[${i + 1}] ${s.title}`).join('\n') || '(none)'}

STORY for this format (6–9 slides): ${FORMAT_RECIPES[input.format]}

${LAYOUT_MENU}

${DESIGN_RULES}

${TASTE_RULES}

Field rules:
- title: the internal idea name, ≤ 10 words.
- angle: one sentence on the specific take that makes this post worth saving.
- trendRelevance: 1–2 sentences on why this matters right now, citing the trigger event.
- audienceRelevance: 1–2 sentences on why a student or aspiring consultant would care (interview prep, case comps, career signal).
- hook: the opening line of the caption and the cover slide's promise, ≤ 16 words. hookVariants: 3 alternatives using different hook patterns.
- slide titles are action titles (full-sentence takeaways). The cover kicker is a series label (e.g. "Guesstimate", "Case in Point", "Industry Lens").
- closing: title is the takeaway; cta invites a comment, save or share and mentions BGCC.
- caption (LinkedIn): 130–220 words. First line states the key number or tension. Short paragraphs with line breaks, a consultant's reasoning, what students should take from it, ends with a question. No hashtags or emoji inside.
- captionInstagram (Instagram and other marketing): 50–100 words. A punchy first line, two or three short lines on why it matters, then "Save this for your next case" or similar, then a question. At most one emoji. No hashtags inside.
- hashtags: 5–7, include #BGCC.
- altText: ≤ 125 characters describing the cover slide.
- needs: assets or research still required (e.g. "verify Q2 revenue figure").`,
  })

  const j = r.json ?? {}
  const slides = normalizeSlides(j.slides ?? [])
  const complexity = Math.min(5, Math.max(1, input.topic.scores?.complexity ?? fmt.complexity))
  const s = input.topic.scores
  const sig = input.topic.signals
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    status: 'built',
    topicId: input.topic.id,
    title: j.title ?? input.topic.label,
    format: input.format,
    alternates: input.alternates ?? [],
    routingReason: input.routingReason ?? '',
    trendRelevance: j.trendRelevance ?? '',
    audienceRelevance: j.audienceRelevance ?? '',
    engagement: {
      score: s?.engagement ?? 0,
      grade: s?.grade ?? 'C',
      components: {
        velocity: sig?.velocity ?? null,
        buzz: sig?.buzz ?? null,
        breadth: sig?.breadth ?? null,
        formatPrior: sig?.formatPrior ?? fmt.prior,
        audienceFit: sig?.audienceFit ?? null,
      },
      evidence: sig?.evidence ?? [`Format: ${fmt.priorNote.toLowerCase()} (directional benchmark)`],
    },
    complexity: { level: complexity, hours: HOURS_BY_COMPLEXITY[complexity], needs: j.needs ?? [] },
    hook: j.hook ?? '',
    hookVariants: j.hookVariants ?? [],
    angle: j.angle ?? '',
    slides,
    caption: j.caption ?? '',
    captionInstagram: j.captionInstagram ?? '',
    storyboard: Array.isArray(j.storyboard) ? j.storyboard.filter((b: any) => b?.beat).map((b: any) => ({ beat: String(b.beat), kind: String(b.kind ?? '') })) : undefined,
    hashtags: (j.hashtags ?? []).map((h: string) => (h.startsWith('#') ? h : `#${h}`)),
    altText: j.altText ?? '',
    sources: input.sources,
    origin: input.origin,
  }
}

/** "1,200", "₹52,878 crore", 46 → a number; anything else → NaN. */
const toNum = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')))
const withUnit = (v: number, unit?: string) => (unit === '₹' || unit === '$' ? `${unit}${v.toLocaleString('en-IN')}` : `${v.toLocaleString('en-IN')}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`)

/** Slides render plain text, so "**Density**:" from the model would show its asterisks. */
const plain = (v: any): any =>
  typeof v === 'string' ? v.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/^#+\s+/, '') : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v

export function normalizeSlides(rawIn: any[]): SlideSpec[] {
  const raw = plain(rawIn)
  let answer: string | null = null
  const out: SlideSpec[] = []
  for (const s of raw) {
    const before = out.length
    switch (s.kind) {
      case 'cover':
        out.push({ kind: 'cover', kicker: s.kicker ?? 'BGCC', title: s.title ?? '', subtitle: s.subtitle })
        break
      case 'statement':
        out.push({ kind: 'statement', title: s.title ?? '', body: s.body ?? '' })
        break
      case 'bullets':
        out.push({ kind: 'bullets', title: s.title ?? '', points: s.points ?? [] })
        break
      case 'stat':
        out.push({ kind: 'stat', value: s.value ?? '', label: s.label ?? '', context: s.context })
        break
      case 'tree': {
        const tree = buildTree(s.nodes ?? [])
        // A tree without numbers is a structure, not an estimate: it would render as a column of zeros.
        const leaves = (t: TreeNode): TreeNode[] => (t.children?.length ? t.children.flatMap(leaves) : [t])
        if (tree && !leaves(tree).some((l) => Number.isFinite(l.value))) {
          const parts = tree.children?.length ? tree.children : [tree]
          out.push({ kind: 'steps', title: s.title ?? '', steps: parts.slice(0, 5).map((p) => ({ title: p.label, body: (p.children ?? []).map((x) => x.label).join(', ') })) })
          break
        }
        if (tree) {
          answer = formatIndian(tree.value ?? 0, tree.unit)
          out.push({ kind: 'tree', title: s.title ?? '', tree, note: s.note })
        }
        break
      }
      case 'matrix':
        if (s.quadrants?.length === 4) {
          out.push({ kind: 'matrix', title: s.title ?? '', xAxis: s.xAxis ?? '', yAxis: s.yAxis ?? '', quadrants: s.quadrants })
        }
        break
      case 'steps':
        out.push({ kind: 'steps', title: s.title ?? '', steps: s.steps ?? [] })
        break
      case 'poll':
        out.push({ kind: 'poll', question: s.question ?? s.title ?? '', options: s.options ?? [] })
        break
      case 'closing':
        out.push({ kind: 'closing', title: s.title ?? '', cta: s.cta ?? '' })
        break
      case 'chart': {
        const data = (s.data ?? [])
          .map((d: any) => ({ label: String(d?.label ?? ''), value: toNum(d?.value) }))
          .filter((d: { label: string; value: number }) => d.label && Number.isFinite(d.value))
          .slice(0, 8)
        if (data.length >= 2) {
          const chart = ['bar', 'column', 'line'].includes(s.chart) ? s.chart : 'bar'
          const hl = Number.isInteger(s.highlight) && s.highlight >= 0 && s.highlight < data.length ? s.highlight : undefined
          out.push({ kind: 'chart', title: s.title ?? '', chart, data, unit: s.unit || undefined, highlight: hl, note: s.note || undefined })
        } else if (data.length === 1) {
          out.push({ kind: 'stat', value: withUnit(data[0].value, s.unit), label: data[0].label, context: s.title })
        }
        break
      }
      case 'kpis': {
        const items = (s.items ?? []).filter((i: any) => i?.value && i?.label).map((i: any) => ({ value: String(i.value), label: String(i.label) })).slice(0, 4)
        if (items.length >= 2) out.push({ kind: 'kpis', title: s.title ?? '', items })
        else if (items.length === 1) out.push({ kind: 'stat', value: items[0].value, label: items[0].label, context: s.title })
        break
      }
      case 'compare': {
        const fix = (x: any) => (x?.name ? { name: String(x.name), stat: x.stat || undefined, statLabel: x.statLabel || undefined, points: (x.points ?? []).map(String).slice(0, 3) } : null)
        const left = fix(s.left)
        const right = fix(s.right)
        if (left && right) out.push({ kind: 'compare', title: s.title ?? '', left, right, verdict: s.verdict || undefined })
        break
      }
      case 'timeline': {
        const events = (s.events ?? []).filter((e: any) => e?.date && e?.text).slice(0, 6)
        if (events.length >= 2) out.push({ kind: 'timeline', title: s.title ?? '', events })
        break
      }
      case 'quote':
        if (s.quote && s.who) out.push({ kind: 'quote', quote: String(s.quote).replace(/^["“]|["”]$/g, ''), who: s.who, role: s.role || undefined })
        break
      case 'table': {
        const columns: string[] = (s.columns ?? []).map(String).slice(0, 5)
        const rows: string[][] = (s.rows ?? [])
          .filter((r: unknown) => Array.isArray(r))
          .map((r: unknown[]) => columns.map((_, i) => String(r[i] ?? '')))
          .slice(0, 7)
        if (columns.length >= 2 && rows.length >= 2) {
          const hl = Number.isInteger(s.highlight) && s.highlight >= 0 && s.highlight < rows.length ? s.highlight : undefined
          out.push({ kind: 'table', title: s.title ?? '', columns, rows, highlight: hl })
        }
        break
      }
      case 'ranked': {
        const items = (s.items ?? []).filter((i: any) => i?.name || i?.label).map((i: any) => ({ name: String(i.name ?? i.label), value: i.value || undefined, note: i.note || i.desc || undefined })).slice(0, 6)
        if (items.length >= 2) out.push({ kind: 'ranked', title: s.title ?? '', items })
        break
      }
      case 'diagram': {
        const items = (s.items ?? []).filter((i: any) => i?.label).map((i: any) => ({ label: String(i.label), desc: i.desc || i.note || undefined })).slice(0, 6)
        const shape = ['pyramid', 'funnel', 'cycle', 'roadmap', 'swot'].includes(s.shape) ? s.shape : 'roadmap'
        if (items.length >= (shape === 'swot' ? 4 : 3)) out.push({ kind: 'diagram', title: s.title ?? '', shape, items, note: s.note || undefined })
        else if (items.length >= 2) out.push({ kind: 'steps', title: s.title ?? '', steps: items.map((i: { label: string; desc?: string }) => ({ title: i.label, body: i.desc ?? '' })) })
        break
      }
    }
    // A picture request and a found picture travel with the slide (an explicit "" removes one).
    const made = out[before]
    if (made && out.length === before + 1) {
      // Models fill unused optional fields with "", so only "none" removes a picture.
      const pic = typeof s.picture === 'string' ? s.picture.trim() : ''
      if (pic) made.picture = /^none$/i.test(pic) ? '' : pic
      if (s.image?.src && made.picture !== '') made.image = s.image
    }
  }
  // The answer slide shows the tree's computed root, never a model-written number.
  for (const s of out) {
    if (s.kind === 'stat' && /\{\{\s*ANSWER\s*\}\}/.test(s.value)) {
      s.value = answer ?? 'See tree'
      s.linked = answer != null
    }
  }
  return out
}

// ---------- research brief ----------

const BRIEF_RULES = `Plain bullets, no preamble. Every bullet carries a specific number, date, name or quote and names its source (publication or filing). Prefer company filings, regulators, Reuters, Bloomberg, Economic Times, Mint, Business Standard, Moneycontrol, Inc42 and research firms; avoid SEO blogs and social media. Mark anything uncertain as such.`

/** A sourced fact brief from Google Search. `deep` runs two searches in parallel: facts and numbers, then reactions and comparables. */
export async function researchBrief(
  label: string,
  summary: string,
  opts: { deep?: boolean; signal?: AbortSignal; registry?: SourceRef[] } = {},
): Promise<{ brief: string; sources: SourceRef[] }> {
  const today = new Date().toDateString()
  const focuses = opts.deep
    ? [
        'the triggering event and its date; the key numbers (revenue, valuation, market size, growth, margins, users, prices) with units and periods; the main players involved. 8–12 bullets.',
        'what analysts, investors, founders and critics are saying (with names); the strongest argument on each side; one comparable case from another company or country with its numbers; what happens next. 6–10 bullets.',
      ]
    : ['the triggering event and its date, the key numbers with units and dates, the main players, what analysts are saying, and one comparable case. 8–12 bullets.']
  // One registry so [n] in the brief points at the returned sources. Pass the card's sources to extend them.
  const registry: SourceRef[] = opts.registry ?? []
  const results = await Promise.allSettled(
    focuses.map((focus) =>
      webFacts(
        `Today is ${today}. Use Google Search to build a fact brief on: "${label}" — ${summary}

Focus: ${focus}
${BRIEF_RULES}`,
        label,
        registry,
        opts.signal,
      ),
    ),
  )
  const ok = results.flatMap((r) => (r.status === 'fulfilled' && r.value.text ? [r.value] : []))
  if (!ok.length) throw results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason ?? new Error(`No sources found for “${label}”.`)
  return { brief: ok.map((r) => r.text).join('\n\n'), sources: registry }
}

// ---------- critic ----------

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str,
          verdict: { type: 'string', enum: ['ship', 'fix', 'kill'] },
          score: { type: 'number' },
          notes: strArr,
          betterHook: str,
        },
        required: ['id', 'verdict', 'score', 'notes'],
      },
    },
  },
  required: ['reviews'],
}

export async function critique(cards: IdeaCard[], brand: BrandProfile, writerModel?: string): Promise<Record<string, Critique>> {
  if (!cards.length) return {}
  const r = await generate({
    role: 'critic',
    avoid: writerModel,
    schema: CRITIC_SCHEMA,
    temperature: 0.3,
    system: `You are a senior member of ${brand.name} reviewing post ideas before they go to the design team. You are demanding but fair. You care about: originality (not a rehash of a headline), hook strength, factual risk (unsourced or shaky numbers), brand fit, and whether a 19-year-old aspiring consultant would save or share it.`,
    prompt: `Review each idea. Score 1–10. Verdict: "ship" (≥ 7.5, ready for design), "fix" (good idea, specific problems), or "kill" (not worth the team's time). Give 2–4 short, specific notes, and a betterHook if you can beat the current one.

${cards
  .map(
    (c) => `ID: ${c.id}
FORMAT: ${FORMATS[c.format].label}
TITLE: ${c.title}
ANGLE: ${c.angle}
HOOK: ${c.hook}
SLIDES: ${c.slides.map((s) => ('title' in s ? s.title : s.kind === 'poll' ? s.question : s.kind === 'stat' ? `${s.value} ${s.label}` : '')).join(' | ')}
SOURCES: ${c.sources.length}`,
  )
  .join('\n\n')}`,
  })
  const out: Record<string, Critique> = {}
  for (const rv of r.json?.reviews ?? []) {
    if (rv?.id) out[rv.id] = { verdict: rv.verdict, score: rv.score, notes: rv.notes ?? [], betterHook: rv.betterHook }
  }
  return out
}

// ---------- small edits (chat + voice tools) ----------

export async function rewriteHooks(card: IdeaCard, brand: BrandProfile, direction: string): Promise<string[]> {
  const r = await generate({
    role: 'chat',
    system: brandSystemPrompt(brand),
    schema: { type: 'object', properties: { hooks: strArr }, required: ['hooks'] },
    temperature: 0.95,
    prompt: `Write 5 new opening hooks (≤ 16 words each) for this post. Direction: ${direction || 'sharper and more surprising'}.
Title: ${card.title}
Angle: ${card.angle}
Current hook: ${card.hook}
Use different patterns: question, surprising number, contrarian, interview framing, pop-culture peg.`,
  })
  return r.json?.hooks ?? []
}
