import { brandSystemPrompt } from './brand'
import { generate } from './gemini'
import { FORMATS, FORMAT_IDS, HOURS_BY_COMPLEXITY, computeSignals, growthRatio, routeFormat, scoreTopic } from './scoring'
import { FEEDS, GLOBAL_SOURCES, SWEEPS, fetchFeed, fetchHackerNews, groundedSweep, hnSeries, wikiSeries } from './sources'
import { getState } from './store'
import type { FormatId, IdeaCard, ProgressStep, RawItem, ScanRun, Topic, TopicTags } from './types'
import { researchBrief, uid } from './writer'

export const SCAN_STEPS = [
  { id: 'collect', label: 'Scanning the news' },
  { id: 'cluster', label: 'Grouping stories into topics' },
  { id: 'signals', label: 'Measuring momentum' },
  { id: 'pick', label: 'Picking the strongest' },
  { id: 'research', label: 'Researching each idea' },
  { id: 'write', label: 'Writing the ideas' },
] as const

type StepId = (typeof SCAN_STEPS)[number]['id']
export type EmitSteps = (steps: ProgressStep[]) => void

function tracker(emit: EmitSteps, only?: StepId[]) {
  const steps: ProgressStep[] = SCAN_STEPS.filter((s) => !only || only.includes(s.id)).map((s) => ({ id: s.id, label: s.label, status: 'pending' }))
  const set = (id: StepId, status: ProgressStep['status'], detail?: string) => {
    const s = steps.find((x) => x.id === id)
    if (s) Object.assign(s, { status, detail })
    emit(steps.map((x) => ({ ...x })))
  }
  emit(steps.map((x) => ({ ...x })))
  return set
}

const TAG_KEYS: (keyof TopicTags)[] = [
  'quantifiable',
  'companySpecific',
  'decisionTension',
  'sectorWide',
  'evergreenConcept',
  'controversial',
  'popCulturePeg',
  'indiaRelevant',
  'brandSafe',
]

const bool = { type: 'boolean' }
const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          summary: { type: 'string' },
          sector: { type: 'string' },
          entity: { type: 'string' },
          wikiTitle: { type: 'string' },
          itemIds: { type: 'array', items: { type: 'string' } },
          audienceFit: { type: 'number' },
          tags: { type: 'object', properties: Object.fromEntries(TAG_KEYS.map((k) => [k, bool])) },
        },
        required: ['label', 'summary', 'sector', 'itemIds', 'audienceFit', 'tags'],
      },
    },
  },
  required: ['topics'],
}

async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++
        out[k] = await fn(xs[k])
      }
    }),
  )
  return out
}

const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'number' },
          title: { type: 'string' },
          format: { type: 'string', enum: FORMAT_IDS },
          formatReason: { type: 'string' },
          trendRelevance: { type: 'string' },
          audienceRelevance: { type: 'string' },
          angle: { type: 'string' },
          hook: { type: 'string' },
          hookVariants: { type: 'array', items: { type: 'string' } },
          complexity: { type: 'number' },
          needs: { type: 'array', items: { type: 'string' } },
        },
        required: ['topic', 'title', 'format', 'formatReason', 'trendRelevance', 'audienceRelevance', 'angle', 'hook', 'complexity'],
      },
    },
  },
  required: ['ideas'],
}

const FRESH_FOR_MS = 3 * 3600_000

/** Steps 1–4: collect stories, cluster them into tagged topics, measure momentum, score and rank. */
async function scanTopics(focus: string | undefined, set: ReturnType<typeof tracker>): Promise<ScanRun> {
  const { settings } = getState()
  const run: ScanRun = { id: uid(), startedAt: new Date().toISOString(), focus, items: [], topics: [], cardIds: [], log: [] }
  const log = (s: string, detail: string, level: 'info' | 'warn' | 'error' = 'info') => run.log.push({ at: new Date().toISOString(), step: s, detail, level })

  // 1. Collect
  set('collect', 'running')
  const jobs: { name: string; p: Promise<RawItem[]> }[] = [
    ...SWEEPS.map((s) => ({ name: `Search sweep: ${s.label}`, p: groundedSweep(s, focus).then((r) => r.items) })),
    { name: 'Hacker News', p: fetchHackerNews() },
    ...FEEDS.map((f) => ({ name: f.name, p: fetchFeed(f, settings.relay) })),
  ]
  const settled = await Promise.allSettled(jobs.map((j) => j.p))
  const seen = new Set<string>()
  let sourcesOk = 0
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value.length) {
        sourcesOk++
        log('collect', `${jobs[i].name}: ${r.value.length} items`)
      }
      for (const it of r.value) {
        const key = it.title.toLowerCase().replace(/\W+/g, ' ').slice(0, 70)
        if (!seen.has(key)) {
          seen.add(key)
          run.items.push(it)
        }
      }
    } else log('collect', `${jobs[i].name}: ${(r.reason as Error)?.message ?? 'failed'}`, 'warn')
  })
  if (run.items.length < 5) throw new Error('Too few stories came back. Check your API key and network, then try again.')
  set('collect', 'done', `${run.items.length} stories from ${sourcesOk} sources`)

  // 2. Cluster + tag. Keep the prompt inside Gemma's 16K tokens/minute.
  set('cluster', 'running')
  // Keep a balance of Indian and world stories: up to 60 global, the rest Indian, so neither crowds out the other.
  const byWeight = [...run.items].sort((a, b) => weight(b) - weight(a))
  const world = byWeight.filter((i) => GLOBAL_SOURCES.has(i.source)).slice(0, 60)
  const ranked = [...world, ...byWeight.filter((i) => !GLOBAL_SOURCES.has(i.source)).slice(0, 140 - world.length)]
  const lines = ranked.map((i) => `${i.id} | ${i.source} | ${i.title}${i.summary ? ` — ${i.summary.slice(0, 110)}` : ''}`)
  const cl = await generate({
    role: 'scout',
    schema: CLUSTER_SCHEMA,
    temperature: 0.2,
    system: 'You are a research analyst for a student consulting club in India that follows both Indian and global business. You group news into business topics and tag each one precisely.',
    prompt: `Group these items into 10–14 business TOPICS that a consulting club could post about. Each topic must be ONE specific story: a named company, deal, launch, result, policy or number (e.g. "Fairfax buys 60.7% of IDBI Bank", "Zepto files DRHP for ₹11,000 crore IPO"). Never a broad theme like "FMCG performance" or "AI adoption". Merge items only when they cover the same story. Give a mix of Indian and global stories (roughly half each), picking the global ones Indian students would still care about: brands they use, big tech, famous companies, deals that shape careers. Drop sport results, politics, crime, disasters, celebrity news and anything a student consulting club should not comment on.
${focus ? `\nThe editor wants topics about: ${focus}. Rank those first, but keep other strong topics too.\n` : ''}
For each topic:
- label: short headline (≤ 9 words)
- summary: 2 sentences with the key facts and numbers
- sector
- entity: the main company or concept, as a search term (e.g. "Zepto", "quick commerce")
- wikiTitle: the exact English Wikipedia article title for that entity, or "" if none exists
- itemIds: ids of the items it covers
- audienceFit: 0–5, how much students preparing for consulting would care
- tags (true/false): quantifiable (the story invites estimating a market size or count from first principles; NOT merely "it has numbers"), companySpecific (about one named company), decisionTension (a strategic choice is being made), sectorWide, evergreenConcept (illustrates a reusable business concept), controversial, popCulturePeg (ties to things students follow), indiaRelevant, brandSafe (false for enforcement actions, raids, fraud, investigations, lawsuits, layoffs framed as tragedy, politics or anything a student club shouldn't comment on)

ITEMS (id | source | title — summary):
${lines.join('\n')}`,
  })
  const itemById = new Map(run.items.map((i) => [i.id, i]))
  run.topics = ((cl.json?.topics ?? []) as any[])
    .filter((t) => t?.label && t.tags)
    .map((t) => {
      const tags = Object.fromEntries(TAG_KEYS.map((k) => [k, Boolean(t.tags[k])])) as unknown as TopicTags
      if (t.tags.brandSafe === undefined) tags.brandSafe = true
      const r = routeFormat(tags)
      return {
        id: uid(),
        label: t.label,
        summary: t.summary,
        sector: t.sector ?? 'Business',
        entity: t.entity || undefined,
        wikiTitle: t.wikiTitle || undefined,
        itemIds: (t.itemIds ?? []).filter((id: string) => itemById.has(id)),
        tags,
        format: r.format,
        alternates: r.alternates,
        routingReason: r.reason,
        _fit: Math.max(0, Math.min(5, Number(t.audienceFit) || 0)) / 5,
      } as Topic & { _fit: number }
    })
    .filter((t) => t.tags.brandSafe)
  if (!run.topics.length) throw new Error('No usable topics came out of the scan. Try again in a minute.')
  set('cluster', 'done', `${run.topics.length} brand-safe topics`)

  // 3. Signals
  set('signals', 'running')
  let measured = 0
  await pool(run.topics, 4, async (t) => {
    const term = t.entity ?? t.label
    const [wiki, hn] = await Promise.all([t.wikiTitle ? wikiSeries(t.wikiTitle) : Promise.resolve(null), hnSeries(term)])
    const items = t.itemIds.map((id) => itemById.get(id)!).filter(Boolean)
    t.signals = computeSignals(t, items, (t as any)._fit, wiki, hn)
    if (t.signals.velocity != null) measured++
  })
  for (const t of run.topics) {
    t.scores = scoreTopic(t, t.itemIds.map((id) => itemById.get(id)!).filter(Boolean))
    delete (t as any)._fit
  }
  run.topics.sort((a, b) => (b.scores?.priority ?? 0) - (a.scores?.priority ?? 0))
  set('signals', 'done', `Wikipedia and Hacker News momentum for ${measured} of ${run.topics.length} topics`)
  getState().upsertRun({ ...run })
  return run
}

export interface IdeasOptions {
  focus?: string
  format?: FormatId
  count?: number
  fresh?: boolean
}

/**
 * "Give me ideas for today": scan (or reuse a scan from the last few hours), pick the strongest topics,
 * research each one with Google Search, then write idea cards with every marker filled in.
 */
export async function ideasForToday(opts: IdeasOptions, emit: EmitSteps): Promise<{ cards: IdeaCard[]; run: ScanRun; reused: boolean }> {
  const count = Math.min(5, Math.max(1, opts.count ?? 3))
  const focus = opts.focus?.trim() || undefined
  const recent = getState().runs.find((r) => r.topics.length && Date.now() - Date.parse(r.startedAt) < FRESH_FOR_MS && (r.focus ?? '') === (focus ?? ''))
  const reuse = !opts.fresh && recent
  const set = tracker(emit, reuse ? ['pick', 'research', 'write'] : undefined)

  const run = reuse ? recent : await scanTopics(focus, set)
  const used = new Set(Object.values(getState().cards).map((c) => c.topicId))

  // 4. Pick
  set('pick', 'running')
  const fits = (t: Topic) => !opts.format || t.format === opts.format || t.alternates.includes(opts.format)
  let pool_ = run.topics.filter((t) => !used.has(t.id) && fits(t))
  if (pool_.length < count) pool_ = run.topics.filter(fits)
  if (pool_.length < count) pool_ = run.topics
  const picks = opts.format ? pool_.slice(0, count) : diversify(pool_, count)
  set('pick', 'done', picks.map((p) => p.label).join(' · '))

  // 5. Research each pick with Google Search (Flash-Lite, in parallel).
  set('research', 'running', `0 of ${picks.length}`)
  let done = 0
  const itemById = new Map(run.items.map((i) => [i.id, i]))
  const briefs = await Promise.all(
    picks.map(async (t) => {
      const items = t.itemIds.map((id) => itemById.get(id)).filter(Boolean) as RawItem[]
      const itemSources = items.filter((i) => i.url).map((i) => ({ title: i.title, url: i.url, source: i.source }))
      try {
        const b = await researchBrief(t.label, t.summary)
        // Brief sources first and uncut, so its [n] citations keep pointing at the right source.
        return { brief: b.brief, sources: dedupeSources([...b.sources, ...itemSources]).slice(0, Math.max(8, b.sources.length)) }
      } catch (err) {
        run.log.push({ at: new Date().toISOString(), step: 'research', detail: `${t.label}: ${(err as Error).message}`, level: 'warn' })
        return { brief: t.summary, sources: itemSources }
      } finally {
        set('research', 'running', `${++done} of ${picks.length}`)
      }
    }),
  )
  set('research', 'done', `${briefs.reduce((n, b) => n + b.sources.length, 0)} sources read`)

  // 6. Write every idea in one call so they don't repeat each other.
  set('write', 'running')
  const { brand } = getState()
  const r = await generate({
    role: 'synth',
    schema: IDEAS_SCHEMA,
    temperature: 0.7,
    system: brandSystemPrompt(brand),
    prompt: `Today is ${new Date().toDateString()}. Turn each researched topic below into ONE sharp post idea for BGCC's Instagram and LinkedIn.

${picks
  .map((t, i) => {
    const allowed = opts.format ? [opts.format] : [t.format, ...t.alternates]
    return `### TOPIC ${i}: ${t.label}
Sector: ${t.sector}
Summary: ${t.summary}
Momentum evidence: ${(t.signals?.evidence ?? []).join('; ') || 'not measured'}
Allowed formats: ${allowed.map((f) => `${f} (${FORMATS[f].blurb})`).join(', ')}. Default: ${allowed[0]} — ${opts.format ? 'requested by the editor' : t.routingReason}
Fact brief:
${briefs[i].brief}`
  })
  .join('\n\n')}

For each topic return:
- topic: its number
- title: the idea's name, ≤ 10 words, specific (company, number or tension in it)
- format: one of the allowed formats for that topic; pick the one that makes the strongest post
- formatReason: one sentence on why that format fits this story
- trendRelevance: 1–2 sentences on why this matters this week, naming the trigger event, its date and the key number from the brief
- audienceRelevance: 1–2 sentences on why a BITS Goa student or aspiring consultant would care (case interviews, guesstimate practice, placements, case competitions)
- angle: the specific take that makes this worth saving, one sentence
- hook: the opening line of the post, ≤ 16 words, using one of the club's hook patterns
- hookVariants: 2 alternative hooks using different patterns
- complexity: 1–5 effort to produce (1 = poll or quick take in under an hour; 5 = multi-slide analysis needing new data)
- needs: 1–3 things still to check or gather before posting

Only use facts that appear in the fact briefs. Never invent numbers.`,
  })
  const raw: any[] = r.json?.ideas ?? []
  const cards: IdeaCard[] = []
  for (const [i, t] of picks.entries()) {
    const j = raw.find((x) => Number(x?.topic) === i) ?? raw[i]
    if (!j?.title) continue
    const allowed = opts.format ? [opts.format] : [t.format, ...t.alternates]
    const format: FormatId = allowed.includes(j.format) ? j.format : allowed[0]
    const level = Math.round(Math.min(5, Math.max(1, Number(j.complexity) || FORMATS[format].complexity)))
    const sig = t.signals
    const series = sig?.wikiSeries ?? sig?.hnSeries
    const card: IdeaCard = {
      id: uid(),
      createdAt: new Date().toISOString(),
      status: 'idea',
      topicId: t.id,
      title: j.title,
      entity: t.entity,
      format,
      alternates: allowed.filter((f) => f !== format),
      routingReason: j.formatReason || t.routingReason,
      trendRelevance: j.trendRelevance,
      audienceRelevance: j.audienceRelevance,
      engagement: {
        score: t.scores?.engagement ?? 0,
        grade: t.scores?.grade ?? 'C',
        components: {
          velocity: sig?.velocity ?? null,
          buzz: sig?.buzz ?? null,
          breadth: sig?.breadth ?? null,
          formatPrior: FORMATS[format].prior,
          audienceFit: sig?.audienceFit ?? null,
        },
        evidence: (sig?.evidence ?? []).filter((e) => !e.startsWith('Format:')).concat(`Format track record: ${FORMATS[format].priorNote}`),
      },
      pace: sig?.pace,
      growth: series ? growthRatio(series) : null,
      complexity: { level, hours: HOURS_BY_COMPLEXITY[level], needs: j.needs ?? [] },
      hook: j.hook,
      hookVariants: j.hookVariants ?? [],
      angle: j.angle ?? '',
      brief: briefs[i].brief,
      slides: [],
      caption: '',
      hashtags: [],
      altText: '',
      sources: briefs[i].sources,
      origin: 'scan',
    }
    getState().upsertCard(card)
    cards.push(card)
  }
  if (!cards.length) throw new Error('The writer returned no ideas. Try again.')
  run.cardIds = [...run.cardIds, ...cards.map((c) => c.id)]
  run.finishedAt = new Date().toISOString()
  getState().upsertRun({ ...run })
  set('write', 'done', `${cards.length} ideas · ${r.model}`)
  return { cards, run, reused: Boolean(reuse) }
}

function weight(i: RawItem) {
  const famBoost = i.family === 'news' ? 3 : i.family === 'business_press' ? 2 : i.family === 'research' ? 2 : 1
  const age = i.publishedAt ? (Date.now() - Date.parse(i.publishedAt)) / 86400000 : 3
  return famBoost + Math.log10(1 + (i.points ?? 0)) - age * 0.2
}

/** Top-N by priority, but no more than two cards of the same format. */
function diversify(topics: Topic[], n: number): Topic[] {
  const out: Topic[] = []
  const count: Record<string, number> = {}
  for (const t of topics) {
    if ((count[t.format] ?? 0) >= 2) continue
    out.push(t)
    count[t.format] = (count[t.format] ?? 0) + 1
    if (out.length >= n) break
  }
  return out
}

export function dedupeSources<T extends { url: string }>(xs: T[]): T[] {
  const seen = new Set<string>()
  return xs.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url))
}

