import { brandSystemPrompt } from './brand'
import { generate, type GenerateResult } from './gemini'
import { FORMATS, FORMAT_IDS, HOURS_BY_COMPLEXITY, computeSignals, growthRatio, scoreTopic } from './scoring'
import { hnSeries, newsSearch, resolveWikiTitle, wikiSeries } from './sources'
import { getState } from './store'
import type { DeepRun, FormatId, IdeaCard, KeyFigure, ProgressStep, RawItem, SourceRef, Topic, TopicTags } from './types'
import { uid } from './id'

// ---------- citation registry ----------

export function domainOf(s: SourceRef): string {
  const fromTitle = s.title && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.title.trim()) ? s.title.trim() : ''
  try {
    const host = new URL(s.url).hostname.replace(/^www\./, '')
    if (host.includes('vertexaisearch') || host.includes('google.com')) return fromTitle || s.source || host
    return host
  } catch {
    return fromTitle || s.title
  }
}

/** Adds a source to the thread registry (deduped by URL) and returns its 1-based citation number. */
export function register(registry: SourceRef[], s: SourceRef): number {
  const i = registry.findIndex((r) => r.url === s.url)
  if (i >= 0) return i + 1
  registry.push(s)
  return registry.length
}

/** Rewrites a grounded answer so each supported sentence ends with [n] citations into the registry. */
export function citeGrounded(r: GenerateResult, registry: SourceRef[]): { text: string; ids: number[] } {
  const map = r.chunks.map((c) => (c.url ? register(registry, c) : 0))
  const ids = new Set<number>(map.filter(Boolean))
  let text = r.text
  // Insert from the end so earlier positions stay valid.
  const inserts: { at: number; tag: string }[] = []
  for (const s of r.supports) {
    if (!s.text) continue
    const pos = text.indexOf(s.text)
    if (pos < 0) continue
    const nums = [...new Set(s.chunks.map((c) => map[c]).filter(Boolean))]
    if (nums.length) inserts.push({ at: pos + s.text.length, tag: nums.map((n) => `[${n}]`).join('') })
  }
  inserts.sort((a, b) => b.at - a.at)
  const seenAt = new Set<number>()
  for (const ins of inserts) {
    if (seenAt.has(ins.at)) continue
    seenAt.add(ins.at)
    text = text.slice(0, ins.at) + ins.tag + text.slice(ins.at)
  }
  return { text, ids: [...ids] }
}

// Rough credibility tiers, so the writer leans on primary and established sources for key numbers.
const TIER_1 = /(reuters|bloomberg|ft\.com|wsj|economist|economictimes|livemint|business-standard|thehindubusinessline|moneycontrol|financialexpress|cnbc|inc42|entrackr|the-ken|themorningcontext|techcrunch|forbes|fortune|mckinsey|bcg|bain|redseer|kpmg|deloitte|pwc|ey\.com|nseindia|bseindia|sebi|rbi\.org|\.gov|nasscom|statista|hbr\.org|nytimes|theverge|ndtvprofit|businesstoday|yourstory|indianexpress|thehindu|hindustantimes|timesofindia|indiatimes|outlookbusiness|fortuneindia|financialexpress|zeebiz|cnbctv18)/i
const LOW = /(facebook|instagram|youtube|tiktok|x\.com|twitter|reddit|quora|pinterest|scribd|binance|medium\.com|linkedin|slideshare|wikipedia)/i
export const sourceTier = (s: SourceRef): 'primary' | 'other' | 'weak' => {
  const d = domainOf(s)
  return TIER_1.test(d) ? 'primary' : LOW.test(d) ? 'weak' : 'other'
}

export const sourceList = (registry: SourceRef[], ids?: number[]) =>
  (ids ?? registry.map((_, i) => i + 1))
    .map((n) => `[${n}] ${domainOf(registry[n - 1])}${registry[n - 1].title && registry[n - 1].title !== domainOf(registry[n - 1]) ? ` — ${registry[n - 1].title}` : ''} (${sourceTier(registry[n - 1])})`)
    .join('\n')

// ---------- deep research ----------

const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: { questions: { type: 'array', items: { type: 'string' } } },
  required: ['questions'],
}

const META_SHAPE = {
  figures: [{ value: 'the number with its unit, e.g. ₹11,000 crore', label: 'what it measures, ≤ 8 words', source: 'citation number' }],
  ideas: [
    {
      title: 'post idea, ≤ 10 words',
      format: FORMAT_IDS.join(' | '),
      formatReason: 'one sentence: why this format fits',
      trendRelevance: 'why this matters this week, with the trigger and a number, citing [n]',
      audienceRelevance: 'why a student or aspiring consultant would care',
      angle: 'the specific take, one sentence',
      hook: 'opening line ≤ 16 words',
      complexity: '1–5',
      entity: 'main company or concept, 1–3 words, used as a search term',
      sources: ['citation numbers that back this idea'],
    },
  ],
  followUps: ['a question worth researching next'],
}

/** Splits a report stream into the visible markdown and the trailing JSON block. */
export function splitReport(text: string): { body: string; meta?: any } {
  const at = text.search(/```json|<meta>/i)
  if (at < 0) return { body: text.trim() }
  const body = text.slice(0, at).trim()
  const raw = text
    .slice(at)
    .replace(/```json|```|<\/?meta>/gi, '')
    .trim()
  try {
    return { body, meta: JSON.parse(raw) }
  } catch {
    return { body }
  }
}

/**
 * Facts for one search, cited into the shared registry. Google Search grounding first; once its free
 * quota is spent, Google News headlines for the query, summarised strictly from what they say.
 */
export async function webFacts(task: string, query: string, registry: SourceRef[], signal?: AbortSignal): Promise<{ text: string; ids: number[]; via: 'google' | 'news' }> {
  try {
    const r = await generate({ role: 'scout', search: true, temperature: 0.2, prompt: task, signal })
    const cited = citeGrounded(r, registry)
    // Ungrounded answers can't be cited, so they don't count.
    if (cited.ids.length && cited.text.trim()) return { ...cited, via: 'google' }
  } catch (err) {
    if (signal?.aborted || (err as { status?: number }).status === 401) throw err
  }
  const items = await newsSearch(query, getState().settings.relay)
  if (!items.length) return { text: '', ids: [], via: 'news' }
  const numbered = items.map((i) => ({ n: register(registry, { title: `${i.title} (${i.source})`, url: i.url, source: i.source }), i }))
  const r = await generate({
    role: 'scout',
    temperature: 0.2,
    signal,
    prompt: `${task}

Google Search is unavailable, so answer ONLY from these news headlines and snippets. Do not add facts, numbers or names that are not in them. Cite every bullet with the bracketed number of the item it comes from, e.g. [12]. If the items don't cover part of the question, say so in one bullet.

NEWS ITEMS:
${numbered.map(({ n, i }) => `[${n}] ${i.publishedAt?.slice(0, 10) ?? 'undated'} · ${i.source} · ${i.title}${i.summary && !i.summary.startsWith(i.title.slice(0, 30)) ? ` — ${i.summary}` : ''}`).join('\n')}`,
  })
  const valid = new Set(numbered.map((x) => x.n))
  const ids = [...new Set([...r.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => valid.has(n)))].sort((a, b) => a - b)
  return { text: r.text.trim(), ids, via: 'news' }
}

async function searchStep(step: ProgressStep, question: string, registry: SourceRef[], today: string): Promise<string | null> {
  const { text, ids, via } = await webFacts(
    `Today is ${today}. Use Google Search to answer: ${step.label}
(Part of a wider question: "${question}")
Write 6–10 dense bullet points. Every bullet must contain a specific number, date, name or direct quote, and name who reported it (publication or company filing). Prefer primary and established sources: company filings and investor presentations, regulators, Reuters, Bloomberg, Economic Times, Mint, Business Standard, Moneycontrol, Inc42, Entrackr, The Ken, and consulting or research firms (Redseer, McKinsey, BCG, Bain). Avoid SEO blogs, social media posts and anonymous market-report sites. Prefer the last 30 days; include older data only as a baseline and say how old it is. Flag anything disputed, estimated or unverified. No preamble.`,
    step.label,
    registry,
  )
  step.sourceIds = ids
  if (via === 'news') step.via = 'news'
  return ids.length ? text || null : null
}

/**
 * Two-round research: plan focused searches, run them in parallel, look for gaps, run follow-up
 * searches, then stream a cited brief that ends with key figures and post ideas carrying every marker.
 */
export async function deepResearch(question: string, registry: SourceRef[], emit: (run: DeepRun) => void, context?: string): Promise<DeepRun> {
  const run: DeepRun = { status: 'planning', question, steps: [], report: '', figures: [], ideaIds: [], followUps: [], startedAt: new Date().toISOString() }
  const push = () => emit(structuredClone(run))
  push()
  const today = new Date().toDateString()
  const findings = new Map<string, string>()

  const runSteps = async (steps: ProgressStep[]) => {
    await Promise.all(
      steps.map(async (step) => {
        step.status = 'running'
        push()
        try {
          const text = await searchStep(step, question, registry, today)
          if (text) findings.set(step.id, text)
          step.status = text ? 'done' : 'error'
          step.detail = text ? `${plural(step.sourceIds?.length ?? 0, 'source')}${step.via === 'news' ? ' · headlines' : ''}` : 'No sources found'
        } catch (err) {
          step.status = 'error'
          step.detail = (err as Error).message
        }
        push()
      }),
    )
  }

  try {
    // 1. Plan
    const plan = await generate({
      role: 'scout',
      schema: QUESTIONS_SCHEMA,
      temperature: 0.4,
      prompt: `Today is ${today}. A student consulting club's marketing team wants to research:
"${question}"
${context ? `\nEarlier in this conversation:\n${context.slice(0, 2500)}\n` : ''}
Write 5 focused Google searches that together give a complete, current, numbers-rich picture. Cover:
1. the latest facts and what triggered the story (with dates)
2. market size, growth and unit economics, with figures
3. the key players and their strategies or financials
4. what analysts, founders, investors or critics are saying, including disagreements
5. a comparable case from another company or country, or the India angle if the question is global
Each search must be specific (names, years, metrics), not generic. Return JSON {"questions": [...]}.`,
    })
    const qs: string[] = (plan.json?.questions ?? []).filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 6)
    if (!qs.length) qs.push(question)
    run.steps = qs.map((q) => ({ id: uid(), label: q, status: 'pending', sourceIds: [] }))
    run.status = 'searching'
    push()

    // 2. Search round one
    await runSteps(run.steps)
    if (!findings.size) throw new Error(run.steps.find((s) => s.status === 'error')?.detail ?? 'Every search failed.')

    // 3. Reflect: what is still missing or unverified?
    run.status = 'reflecting'
    push()
    try {
      const gaps = await generate({
        role: 'scout',
        schema: QUESTIONS_SCHEMA,
        temperature: 0.3,
        prompt: `Question: "${question}"
Findings so far:
${[...findings.values()].join('\n\n').slice(0, 16000)}

List up to 3 follow-up Google searches that would fill the most important gaps: a key number that is missing or only estimated, a claim with a single weak source that needs confirming, or a side of the debate that is missing. Each search must stand on its own (name the company, metric and period); never refer to "the findings" or "the text". Return {"questions": []} if the findings are already complete.`,
      })
      const extra: string[] = (gaps.json?.questions ?? []).filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3)
      if (extra.length) {
        const more = extra.map((q) => ({ id: uid(), label: q, status: 'pending' as const, sourceIds: [] as number[], detail: 'Follow-up' }))
        run.steps.push(...more)
        run.status = 'searching'
        push()
        await runSteps(more)
      }
    } catch {
      /* the first round is enough to write from */
    }

    // 4. Write a cited brief, streamed.
    run.status = 'writing'
    push()
    const good = run.steps.filter((s) => findings.has(s.id))
    const used = [...new Set(good.flatMap((s) => s.sourceIds ?? []))].sort((a, b) => a - b)
    const { brand } = getState()
    const r = await generate({
      role: 'synth',
      temperature: 0.5,
      system: `${brandSystemPrompt(brand)}

You are also the club's lead research analyst. You write sharp, rigorous research briefs for students who want to think like consultants: structured, numbers-first, honest about uncertainty.`,
      prompt: `Write a research brief answering: "${question}"

FINDINGS (already cited with [n] numbers):
${good.map((s) => `### ${s.label}\n${findings.get(s.id)}`).join('\n\n')}

SOURCES:
${sourceList(registry, used)}
${good.some((s) => s.via === 'news') ? '\nNOTE: Google Search quota ran out, so some findings come from news headlines and snippets only. Stay close to what they say, avoid over-precise claims, and mention once, briefly, that parts of this brief rest on headlines.\n' : ''}
FORMAT (markdown):
- Open with one paragraph starting "**Bottom line:**" that answers the question directly in 2–3 sentences.
- Then "## " sections: "What's happening", "The numbers that matter" (a markdown table when there are 3+ comparable figures), "The debate" (who argues what, and the strongest point on each side), "What a consultant would ask next". Add "## The India angle" when relevant.
- About 450–700 words. Short paragraphs, bullets, bold the key numbers.
- Cite every fact with the [n] numbers above, right after the claim, e.g. "revenue rose 52% [3]". Only use those numbers. Never invent facts, figures or sources. If sources disagree, say so and give the range.
- Each source is labelled primary, other or weak. Back headline numbers with primary sources wherever one exists; never rely on a weak source alone for a key figure. Treat market-research-firm projections as estimates and say so.
- Be precise about periods (FY26, Q1 FY27, calendar 2026) and units.

After the report, output a fenced \`\`\`json block with exactly this shape:
${JSON.stringify(META_SHAPE)}
Give 3–4 figures (the most striking, best-sourced numbers, each with its citation number), exactly 3 post ideas for BGCC. Ideas must be specific and surprising: each title names a company, a number or a tension (e.g. "Blinkit went profitable on ₹525 baskets. Can Zepto at ₹357?"), never a generic label like "X's playbook". Each entity must be a real company, product or named concept with its own Wikipedia article (e.g. "Blinkit", "Zepto", "Quick commerce"), never an abbreviation or a season. Use different formats where possible (guesstimate for number-shaped questions, case_breakdown for one company's strategic choice, framework for an evergreen concept, industry_analysis for sector shifts, interactive for split opinions, quick_take for fast news), and 3 follow-up questions.`,
      onText: (t) => {
        run.report = splitReport(t).body
        push()
      },
    })
    const { body, meta } = splitReport(r.text)
    run.report = body
    run.figures = ((meta?.figures ?? []) as KeyFigure[])
      .filter((f) => f?.value && f?.label)
      .map((f) => ({ ...f, source: Number(f.source) || undefined }))
      .slice(0, 4)

    // 5. Turn the ideas into cards and measure their momentum.
    run.status = 'ideas'
    push()
    const ideas = ((meta?.ideas ?? []) as any[]).filter((x) => x?.title).slice(0, 3)
    const cards = await Promise.all(ideas.map((x) => ideaFromResearch(x, run, registry)))
    run.ideaIds = cards.map((c) => c.id)
    run.followUps = (meta?.followUps ?? []).filter((q: unknown) => typeof q === 'string').slice(0, 3)
    run.status = 'done'
  } catch (err) {
    run.status = 'error'
    run.error = (err as Error).message
  }
  run.finishedAt = new Date().toISOString()
  push()
  return run
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g

/**
 * The report cites the chat's registry, which can run to 100+ sources. A card carries its own list, so renumber:
 * the idea's own sources first, then everything else the report cites, up to 30. Citations to sources that didn't
 * make the cut are dropped, so every [n] in the card's brief points at card.sources[n - 1].
 */
export function localCitations(report: string, registry: SourceRef[], first: number[]) {
  const cited = [...report.matchAll(CITE_RE)].flatMap((m) => m[1].split(',').map((n) => Number(n.trim())))
  const order = [...new Set([...first, ...cited])].filter((n) => registry[n - 1]).slice(0, 30)
  const local = new Map(order.map((n, i) => [n, i + 1]))
  const brief = report.replace(CITE_RE, (_, g: string) => {
    const kept = [...new Set(g.split(',').map((n) => local.get(Number(n.trim()))).filter((n): n is number => Boolean(n)))]
    return kept.length ? `[${kept.join(', ')}]` : ''
  })
  return { brief, sources: order.map((n) => registry[n - 1]) }
}

async function ideaFromResearch(x: any, run: DeepRun, registry: SourceRef[]): Promise<IdeaCard> {
  const format: FormatId = FORMAT_IDS.includes(x.format) ? x.format : 'quick_take'
  const ids = ((x.sources ?? []) as unknown[]).map(Number).filter((n) => registry[n - 1])
  const { brief, sources } = localCitations(run.report, registry, ids)
  const measured = await measureTopic(x.title, x.entity || x.title, format, sources).catch(() => null)
  const level = Math.round(Math.min(5, Math.max(1, Number(x.complexity) || FORMATS[format].complexity)))
  const strip = (t: string) => String(t ?? '').replace(/\s*\[\d+\]/g, '')
  const sig = measured?.signals
  const series = sig?.wikiSeries ?? sig?.hnSeries
  const card: IdeaCard = {
    id: uid(),
    createdAt: new Date().toISOString(),
    status: 'idea',
    title: x.title,
    entity: x.entity,
    format,
    alternates: FORMAT_IDS.filter((f) => f !== format).slice(0, 2),
    routingReason: x.formatReason ?? FORMATS[format].blurb,
    trendRelevance: strip(x.trendRelevance),
    audienceRelevance: strip(x.audienceRelevance),
    engagement: measured
      ? {
          score: measured.scores!.engagement,
          grade: measured.scores!.grade,
          components: { velocity: sig!.velocity, buzz: sig!.buzz, breadth: sig!.breadth, formatPrior: sig!.formatPrior, audienceFit: sig!.audienceFit },
          evidence: [`Researched across ${run.steps.length} searches with ${sources.length} cited sources`, ...sig!.evidence],
        }
      : { score: 0, grade: 'C', components: {}, evidence: [] },
    pace: sig?.pace,
    growth: series ? growthRatio(series) : null,
    complexity: { level, hours: HOURS_BY_COMPLEXITY[level], needs: [] },
    hook: x.hook ?? '',
    hookVariants: [],
    angle: x.angle ?? '',
    brief,
    slides: [],
    caption: '',
    hashtags: [],
    altText: '',
    sources,
    origin: 'research',
  }
  getState().upsertCard(card)
  return card
}

// ---------- scoring for ideas born in research ----------

const NO_TAGS: TopicTags = {
  quantifiable: false,
  companySpecific: false,
  decisionTension: false,
  sectorWide: false,
  evergreenConcept: false,
  controversial: false,
  popCulturePeg: false,
  indiaRelevant: true,
  brandSafe: true,
}

/**
 * Measures the same momentum signals the scan uses (Wikipedia pageviews, Hacker News activity,
 * source breadth) for a topic that came from research rather than the radar.
 */
export async function measureTopic(label: string, searchTerm: string, format: FormatId, sources: SourceRef[]): Promise<Pick<Topic, 'signals' | 'scores'>> {
  const title = await resolveWikiTitle(searchTerm)
  const [wiki, hn] = await Promise.all([wikiSeries(title), hnSeries(searchTerm)])
  const items: RawItem[] = sources.map((s, i) => ({
    id: String(i),
    title: s.title,
    url: s.url,
    source: domainOf(s),
    family: /mckinsey|bcg|bain|hbr|stratechery/.test(domainOf(s)) ? 'research' : /inc42|livemint|economictimes|business-standard|yourstory|moneycontrol|thehindubusinessline/.test(domainOf(s)) ? 'business_press' : 'news',
  }))
  const topic = { id: '', label, summary: '', sector: '', itemIds: [], tags: NO_TAGS, format, alternates: [], routingReason: '', wikiTitle: title } as Topic
  // Requested by the team, so audience fit starts high; the reviewer can still kill it.
  topic.signals = computeSignals(topic, items, 0.8, wiki, hn)
  topic.scores = scoreTopic(topic, items)
  return { signals: topic.signals, scores: topic.scores }
}

export function applyMeasurement(card: IdeaCard, m: Pick<Topic, 'signals' | 'scores'>, extraEvidence: string[] = []): IdeaCard {
  const s = m.signals!
  return {
    ...card,
    engagement: {
      score: m.scores!.engagement,
      grade: m.scores!.grade,
      components: { velocity: s.velocity, buzz: s.buzz, breadth: s.breadth, formatPrior: s.formatPrior, audienceFit: s.audienceFit },
      evidence: [...extraEvidence, ...s.evidence],
    },
  }
}
