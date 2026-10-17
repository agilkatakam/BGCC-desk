import type { FormatId, PaceBadge, RawItem, Signals, Topic, TopicTags } from './types'

export const FORMATS: Record<
  FormatId,
  { label: string; short: string; blurb: string; prior: number; complexity: number; priorNote: string }
> = {
  guesstimate: {
    label: 'Guesstimate',
    short: 'Guesstimate',
    blurb: 'Market sizing with an explicit assumption tree',
    prior: 0.78,
    complexity: 3,
    priorNote: 'Interview-prep carousels are saved and re-shared; readers comment with their own numbers',
  },
  case_breakdown: {
    label: 'Business case breakdown',
    short: 'Case breakdown',
    blurb: 'Situation → complication → structure → recommendation',
    prior: 0.72,
    complexity: 3,
    priorNote: 'Mirrors case-interview prompts, which this audience actively practises',
  },
  framework: {
    label: 'Consulting framework',
    short: 'Framework',
    blurb: 'A named framework applied to this week’s example',
    prior: 0.8,
    complexity: 2,
    priorNote: 'Cheat-sheet carousels earn the most saves of any format',
  },
  industry_analysis: {
    label: 'Industry analysis',
    short: 'Industry analysis',
    blurb: 'Value chain, profit pools and where the sector is heading',
    prior: 0.66,
    complexity: 4,
    priorNote: 'BGCC’s primers (Logistics, FinTech) are its best-performing LinkedIn posts',
  },
  interactive: {
    label: 'Interactive post',
    short: 'Interactive',
    blurb: 'Poll, pick-a-side or “what would you recommend?”',
    prior: 0.7,
    complexity: 1,
    priorNote: 'Polls and either/or prompts drive comments at very low production cost',
  },
  quick_take: {
    label: 'Short-form analysis',
    short: 'Quick take',
    blurb: 'What happened, why it matters, what a consultant would ask',
    prior: 0.56,
    complexity: 1,
    priorNote: 'Fast to ship while the news is fresh; reach decays within days',
  },
}

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

// First matching rule decides the format; later matches become alternates.
const RULES: { format: FormatId; test: (t: TopicTags) => boolean; reason: string }[] = [
  {
    format: 'guesstimate',
    test: (t) => t.quantifiable && !t.companySpecific,
    reason: 'The story turns on a number anyone can estimate from first principles',
  },
  {
    format: 'case_breakdown',
    test: (t) => t.companySpecific && t.decisionTension,
    reason: 'A single company faces a real strategic choice, which is the shape of a case interview',
  },
  {
    format: 'industry_analysis',
    test: (t) => t.sectorWide,
    reason: 'The development reshapes a whole sector, so a value-chain view explains it best',
  },
  {
    format: 'framework',
    test: (t) => t.evergreenConcept,
    reason: 'An evergreen concept sits underneath, so a reusable framework gives it shelf-life',
  },
  {
    format: 'interactive',
    test: (t) => t.controversial || t.popCulturePeg,
    reason: 'Opinion is split or there is a pop-culture hook, so a poll will pull comments',
  },
  {
    format: 'guesstimate',
    test: (t) => t.quantifiable,
    reason: 'The company’s scale invites a sizing exercise',
  },
]

export function routeFormat(tags: TopicTags): { format: FormatId; alternates: FormatId[]; reason: string } {
  const hits = RULES.filter((r) => r.test(tags))
  if (!hits.length) {
    return { format: 'quick_take', alternates: ['interactive'], reason: 'Timely but narrow, so a short analysis while it is fresh' }
  }
  const alternates = [...new Set(hits.slice(1).map((h) => h.format))].filter((f) => f !== hits[0].format)
  return { format: hits[0].format, alternates, reason: hits[0].reason }
}

// ---------- signals ----------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const clamp = (x: number) => Math.max(0, Math.min(1, x))

/** Ratio of the last 3 days' average to the prior 14 days' average. */
export function growthRatio(series: number[]): number | null {
  if (series.length < 17) return null
  const recent = mean(series.slice(-3))
  const base = mean(series.slice(-17, -3))
  if (recent + base < 3) return null // too little activity to say anything
  return recent / Math.max(base, 0.5)
}

const ratioToScore = (r: number) => 1 / (1 + Math.exp(-1.3 * Math.log(r)))

export function paceFor(r: number | null): PaceBadge {
  if (r == null) return 'Unmeasured'
  if (r >= 3) return 'Exploding'
  if (r >= 1.4) return 'Rising'
  if (r >= 0.8) return 'Steady'
  return 'Cooling'
}

const FAMILY_LABEL: Record<string, string> = {
  news: 'news',
  business_press: 'business press',
  search: 'search trends',
  community: 'online community',
  reference: 'Wikipedia',
  research: 'consulting research',
}

export function computeSignals(
  topic: Topic,
  items: RawItem[],
  audienceFit: number,
  wiki: number[] | null,
  hn: { series: number[]; topPoints: number; topComments: number } | null,
): Signals {
  const evidence: string[] = []
  const wikiRatio = wiki ? growthRatio(wiki) : null
  const hnRatio = hn ? growthRatio(hn.series) : null
  const ratios = [wikiRatio, hnRatio].filter((r): r is number => r != null)
  const best = ratios.length ? Math.max(...ratios) : null

  if (wikiRatio != null && wiki) {
    evidence.push(
      `Wikipedia views for “${topic.wikiTitle}” are ${wikiRatio.toFixed(1)}× their 2-week baseline (${Math.round(mean(wiki.slice(-3))).toLocaleString()}/day)`,
    )
  }
  if (hnRatio != null) evidence.push(`Hacker News story count is ${hnRatio.toFixed(1)}× its 2-week baseline`)

  const families = new Set(items.map((i) => i.family))
  if (wiki) families.add('reference')
  const breadth = clamp(families.size / 4)
  evidence.push(
    `Covered by ${items.length} item${items.length === 1 ? '' : 's'} across ${families.size} source type${families.size === 1 ? '' : 's'}: ${[...families].map((f) => FAMILY_LABEL[f]).join(', ')}`,
  )

  const coverage = clamp(items.length / 5)
  const topItem = items.reduce((a, b) => ((b.points ?? 0) > (a?.points ?? 0) ? b : a), items[0])
  const hnPts = Math.max(hn?.topPoints ?? 0, topItem?.points ?? 0)
  const hnCom = Math.max(hn?.topComments ?? 0, topItem?.comments ?? 0)
  let buzz: number | null = coverage
  if (hnPts > 0) {
    const hnScore = 0.5 * clamp(Math.log10(1 + hnPts) / 3) + 0.5 * clamp(Math.log10(1 + hnCom) / 2.7)
    buzz = 0.6 * hnScore + 0.4 * coverage
    evidence.push(`Most-discussed Hacker News thread: ${hnPts} points, ${hnCom} comments`)
  }

  const fmt = FORMATS[topic.format]
  evidence.push(`Format: ${fmt.priorNote.toLowerCase()} (directional benchmark)`)

  return {
    velocity: best == null ? null : ratioToScore(best),
    buzz,
    breadth,
    formatPrior: fmt.prior,
    audienceFit: clamp(audienceFit),
    pace: paceFor(best),
    evidence,
    wikiSeries: wiki ?? undefined,
    hnSeries: hn?.series,
  }
}

export const EP_WEIGHTS = { velocity: 0.28, buzz: 0.22, breadth: 0.18, formatPrior: 0.17, audienceFit: 0.15 }

export function scoreTopic(topic: Topic, items: RawItem[]): NonNullable<Topic['scores']> {
  const s = topic.signals!
  let total = 0
  let weight = 0
  for (const [k, w] of Object.entries(EP_WEIGHTS)) {
    const v = s[k as keyof typeof EP_WEIGHTS]
    if (v == null) continue
    total += w * v
    weight += w
  }
  const engagement = Math.round((100 * total) / weight)

  const measured = (s.velocity != null ? 1 : 0) + (s.breadth >= 0.75 ? 1 : 0) + ((s.buzz ?? 0) > 0.5 ? 1 : 0)
  const grade = measured >= 2 ? 'A' : measured === 1 ? 'B' : 'C'

  const newest = Math.max(0, ...items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : 0)))
  const ageDays = newest ? (Date.now() - newest) / 86400000 : 4
  const recency = Math.exp(-ageDays / 5)
  const trend = Math.round(100 * (0.5 * (s.velocity ?? 0.5) + 0.3 * s.breadth + 0.2 * recency))

  const complexity = Math.min(5, FORMATS[topic.format].complexity + (items.length < 2 ? 1 : 0))
  const priority = Math.round(
    100 * Math.cbrt((trend / 100) * s.audienceFit * (engagement / 100)) * (1 - 0.1 * (complexity - 1)),
  )
  return { trend, engagement, grade, complexity, priority }
}

export const HOURS_BY_COMPLEXITY = [0, 1, 1.5, 3, 4.5, 6]
