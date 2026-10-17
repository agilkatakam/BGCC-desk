export type FormatId =
  | 'guesstimate'
  | 'case_breakdown'
  | 'framework'
  | 'industry_analysis'
  | 'interactive'
  | 'quick_take'

export type SourceFamily = 'news' | 'business_press' | 'search' | 'community' | 'reference' | 'research'

export interface RawItem {
  id: string
  title: string
  summary?: string
  url: string
  source: string
  family: SourceFamily
  publishedAt?: string
  points?: number
  comments?: number
}

export interface SourceRef {
  title: string
  url: string
  source?: string
}

export interface TopicTags {
  quantifiable: boolean
  companySpecific: boolean
  decisionTension: boolean
  sectorWide: boolean
  evergreenConcept: boolean
  controversial: boolean
  popCulturePeg: boolean
  indiaRelevant: boolean
  brandSafe: boolean
}

export type PaceBadge = 'Exploding' | 'Rising' | 'Steady' | 'Cooling' | 'Unmeasured'

export interface Signals {
  velocity: number | null // 0–1
  buzz: number | null // 0–1
  breadth: number // 0–1
  formatPrior: number // 0–1
  audienceFit: number // 0–1
  pace: PaceBadge
  evidence: string[]
  wikiSeries?: number[]
  hnSeries?: number[]
}

export interface Topic {
  id: string
  label: string
  summary: string
  sector: string
  entity?: string
  wikiTitle?: string
  itemIds: string[]
  tags: TopicTags
  format: FormatId
  alternates: FormatId[]
  routingReason: string
  signals?: Signals
  scores?: {
    trend: number
    engagement: number
    grade: 'A' | 'B' | 'C'
    complexity: number
    priority: number
  }
}

/** A real picture on a slide, stored inline so render and export work offline. */
export interface SlideImage {
  src: string // data URL
  credit: string
  page?: string // where it came from
  origin?: string // the image's own URL, so a new search can skip it
  query: string // what was searched for
}

/** Any slide may ask for a picture (`picture`: what to show); `image` is the one found. */
export type SlideSpec = SlideLayout & { picture?: string; image?: SlideImage }

export type SlideLayout =
  | { kind: 'cover'; kicker: string; title: string; subtitle?: string }
  | { kind: 'statement'; title: string; body: string }
  | { kind: 'bullets'; title: string; points: string[] }
  | { kind: 'stat'; value: string; label: string; context?: string; linked?: boolean }
  | { kind: 'tree'; title: string; tree: TreeNode; note?: string }
  | { kind: 'matrix'; title: string; xAxis: string; yAxis: string; quadrants: { title: string; body: string }[] }
  | { kind: 'steps'; title: string; steps: { title: string; body: string }[] }
  | { kind: 'poll'; question: string; options: string[] }
  | { kind: 'closing'; title: string; cta: string }
  // Data and layout slides. Charts and numbers are drawn in code from the values given.
  | { kind: 'chart'; title: string; chart: 'bar' | 'column' | 'line'; data: { label: string; value: number }[]; unit?: string; highlight?: number; note?: string }
  | { kind: 'kpis'; title: string; items: { value: string; label: string }[] }
  | { kind: 'compare'; title: string; left: Side; right: Side; verdict?: string }
  | { kind: 'timeline'; title: string; events: { date: string; text: string }[] }
  | { kind: 'quote'; quote: string; who: string; role?: string }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][]; highlight?: number }
  | { kind: 'ranked'; title: string; items: { name: string; value?: string; note?: string }[] }
  // Rendered with AntV Infographic templates.
  | { kind: 'diagram'; title: string; shape: DiagramShape; items: { label: string; desc?: string }[]; note?: string }

export interface Side {
  name: string
  stat?: string
  statLabel?: string
  points: string[]
}

export type DiagramShape = 'pyramid' | 'funnel' | 'cycle' | 'roadmap' | 'swot'

export type StyleId = 'editorial' | 'bold' | 'minimal'

/** One fact-check result for a number or claim on a slide or in the caption. */
export interface FactCheck {
  slide: number // -1 = caption
  claim: string
  status: 'sourced' | 'computed' | 'assumption' | 'derived' | 'unsupported'
  source?: number // 1-based index into the card's sources
  note?: string
}

export interface TreeNode {
  label: string
  op: 'multiply' | 'sum' | 'input'
  value?: number
  unit?: string
  children?: TreeNode[]
}

export interface Critique {
  verdict: 'ship' | 'fix' | 'kill'
  score: number
  notes: string[]
  betterHook?: string
}

export type PaletteId = 'bgcc' | 'bgcc_light' | 'navy' | 'forest' | 'plum'

export interface Palette {
  ink: string
  accent: string
  paper: string
  muted: string
  // Every slide on the dark ground (BGCC's own look) instead of only cover and closing.
  allDark?: boolean
}

export interface IdeaCard {
  id: string
  createdAt: string
  // 'idea' = a suggestion with every marker; 'built' = slides, caption and review written.
  status: 'idea' | 'built'
  topicId?: string
  threadId?: string
  title: string
  entity?: string
  format: FormatId
  alternates: FormatId[]
  routingReason: string
  trendRelevance: string
  audienceRelevance: string
  engagement: { score: number; grade: 'A' | 'B' | 'C'; components: Record<string, number | null>; evidence: string[] }
  pace?: PaceBadge
  growth?: number | null
  complexity: { level: number; hours: number; needs: string[] }
  hook: string
  hookVariants: string[]
  angle: string
  // Fact brief behind the idea, reused when the post is built.
  brief?: string
  slides: SlideSpec[]
  caption: string
  hashtags: string[]
  altText: string
  sources: SourceRef[]
  palette?: PaletteId
  style?: StyleId
  // Instagram/marketing caption; `caption` is the LinkedIn one.
  captionInstagram?: string
  // The story plan the slides were written from.
  storyboard?: { beat: string; kind: string }[]
  checks?: FactCheck[]
  // Layout problems the design check found and could not fix.
  designNotes?: string[]
  critique?: Critique
  origin: 'scan' | 'chat' | 'voice' | 'research'
}

export interface ScanRun {
  id: string
  startedAt: string
  finishedAt?: string
  focus?: string
  items: RawItem[]
  topics: Topic[]
  cardIds: string[]
  log: { at: string; step: string; detail: string; level: 'info' | 'warn' | 'error' }[]
}

export interface BrandProfile {
  name: string
  handle: string
  voice: string[]
  dos: string[]
  donts: string[]
  hookPatterns: string[]
  hashtags: string[]
  audience: string[]
  exemplars: string[]
  palette: Palette
  updatedAt: string
}

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface ProgressStep {
  id: string
  label: string
  status: StepStatus
  detail?: string
  sourceIds?: number[]
  // 'news' when Google Search quota was spent and Google News headlines were used instead.
  via?: 'google' | 'news'
}

export interface KeyFigure {
  value: string
  label: string
  source?: number
}

export interface DeepRun {
  status: 'planning' | 'searching' | 'reflecting' | 'writing' | 'ideas' | 'done' | 'error'
  question: string
  steps: ProgressStep[]
  report: string
  figures: KeyFigure[]
  ideaIds: string[]
  followUps: string[]
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface Attachment {
  name: string
  mime: string
  // Small preview for images; the full data is only sent to the model.
  thumb?: string
}

export interface AskSpec {
  question: string
  options: string[]
  kind: 'choice' | 'look'
  cardId?: string // for 'look': the idea whose cover is previewed
  answer?: string
}

export interface ChatPart {
  type: 'text' | 'tool' | 'progress' | 'research' | 'ideas' | 'deck' | 'ask' | 'files'
  text?: string
  tool?: { name: string; label: string; status: 'running' | 'done' | 'error'; detail?: string }
  progress?: { title: string; steps: ProgressStep[]; done?: boolean }
  research?: DeepRun
  cardIds?: string[]
  cardId?: string
  ask?: AskSpec
  files?: Attachment[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  createdAt: string
  followUps?: string[]
  error?: string
}

export interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  // Every source cited in the thread; citation [n] refers to sources[n - 1].
  sources: SourceRef[]
  // Raw Gemini contents, kept verbatim so thought signatures survive tool loops.
  history: unknown[]
}
