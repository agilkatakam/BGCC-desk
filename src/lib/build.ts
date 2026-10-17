import { brandSystemPrompt } from './brand'
import { designInstruction, longHeads, renderDeck, reviewDesign, type DesignReview } from './design'
import { factCheck, fixInstruction, recheck } from './factcheck'
import { generate } from './gemini'
import { measureTopic } from './research'
import { FORMATS, FORMAT_IDS, HOURS_BY_COMPLEXITY, growthRatio, routeFormat } from './scoring'
import { findPictures } from './images'
import { getState } from './store'
import { TASTE_RULES, lintTaste } from './taste'
import type { FactCheck, FormatId, IdeaCard, PaletteId, ProgressStep, SlideSpec, StyleId, TreeNode } from './types'
import { LAYOUT_MENU, SLIDE_SCHEMA, critique, normalizeSlides, researchBrief, writeCard } from './writer'

export interface BuildOptions {
  format?: FormatId
  palette?: PaletteId
  style?: StyleId
  direction?: string
}

type Emit = (steps: ProgressStep[]) => void

function tracker(emit: Emit, labels: [string, string][]) {
  const steps: ProgressStep[] = labels.map(([id, label]) => ({ id, label, status: 'pending' }))
  const set = (id: string, status: ProgressStep['status'], detail?: string) => {
    const s = steps.find((x) => x.id === id)
    if (s) Object.assign(s, { status, detail })
    emit(steps.map((x) => ({ ...x })))
  }
  emit(steps.map((x) => ({ ...x })))
  return set
}

const BUILD_STEPS: [string, string][] = [
  ['research', 'Checking the latest facts'],
  ['write', 'Planning the story and writing the slides'],
  ['pictures', 'Finding pictures'],
  ['facts', 'Fact-checking every number'],
  ['design', 'Design check on the rendered slides'],
  ['fix', 'Fixing what the checks found'],
  ['review', 'Senior review'],
]

/** Builds an existing idea into slides, a caption and a review, keeping every marker it already has. */
export async function buildIdea(card: IdeaCard, opts: BuildOptions, emit: Emit): Promise<IdeaCard> {
  const { brand, upsertCard } = getState()
  const set = tracker(emit, BUILD_STEPS)
  const format = opts.format ?? card.format

  set('research', 'running')
  let brief = card.brief ?? ''
  // New sources join after the card's own, so [n] in the brief stays aligned with card.sources.
  const sources = [...card.sources]
  try {
    // Research-born ideas already carry a long cited report; one fresh search tops it up.
    const fresh = await researchBrief(card.title, card.angle || card.trendRelevance, { deep: brief.length < 1500, registry: sources })
    brief = [brief, fresh.brief].filter(Boolean).join('\n\n')
    set('research', 'done', `${sources.length} sources`)
  } catch (err) {
    set('research', brief ? 'skipped' : 'error', brief ? 'Using the research already done' : (err as Error).message)
    if (!brief) throw err
  }

  set('write', 'running', FORMATS[format].label)
  const written = await writeCard(
    {
      topic: { id: card.topicId, label: card.title, summary: card.angle || card.trendRelevance, sector: card.entity ?? 'Business' },
      format,
      alternates: card.alternates,
      routingReason: format === card.format ? card.routingReason : 'Chosen by the editor',
      brief: brief.slice(0, 14000),
      sources,
      extraDirection: [
        card.hook && `The idea's suggested hook was: "${card.hook}". Keep it or beat it.`,
        card.angle && `Angle to keep: ${card.angle}`,
        opts.direction,
      ]
        .filter(Boolean)
        .join('\n'),
      origin: card.origin,
    },
    brand,
  )
  set('write', 'done', `${written.slides.length} slides`)

  let built: IdeaCard = {
    ...card,
    status: 'built',
    format,
    alternates: format === card.format ? card.alternates : [card.format, ...card.alternates.filter((f) => f !== format)],
    hook: written.hook || card.hook,
    hookVariants: [...new Set([...written.hookVariants, ...card.hookVariants].filter((h) => h && h !== written.hook))].slice(0, 6),
    trendRelevance: card.trendRelevance || written.trendRelevance,
    audienceRelevance: card.audienceRelevance || written.audienceRelevance,
    angle: card.angle || written.angle,
    complexity: { ...card.complexity, needs: written.complexity.needs.length ? written.complexity.needs : card.complexity.needs },
    brief,
    slides: written.slides,
    caption: written.caption,
    captionInstagram: written.captionInstagram,
    storyboard: written.storyboard,
    hashtags: written.hashtags,
    altText: written.altText,
    sources,
    palette: opts.palette ?? card.palette ?? 'bgcc',
    style: opts.style ?? card.style ?? 'editorial',
    checks: undefined,
    designNotes: undefined,
  }
  upsertCard(built)
  set('pictures', 'running')
  try {
    const p = await findPictures(built)
    built = p.card
    upsertCard(built)
    set('pictures', p.wanted ? 'done' : 'skipped', p.wanted ? `${p.found} of ${p.wanted} found` : 'No slide needs one')
  } catch (err) {
    set('pictures', 'skipped', (err as Error).message)
  }
  built = await checkAndFix(built, set)

  set('review', 'running')
  try {
    const reviews = await critique([built], brand, undefined)
    const rv = reviews[built.id]
    if (rv) {
      built.critique = rv
      if (rv.betterHook && !built.hookVariants.includes(rv.betterHook)) built.hookVariants = [rv.betterHook, ...built.hookVariants]
      upsertCard({ ...built })
    }
    set('review', 'done', rv ? `${rv.verdict === 'ship' ? 'Ship it' : rv.verdict === 'fix' ? 'Needs fixes' : 'Kill it'} · ${rv.score}/10` : undefined)
  } catch {
    set('review', 'skipped', 'Review skipped (quota)')
  }
  return built
}

type Mark = ReturnType<typeof tracker>
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const notesOf = (xs: { slide: number; problem: string }[]) =>
  xs.length ? xs.map((x) => `${x.slide < 0 ? 'Captions' : `Slide ${x.slide + 1}`}: ${x.problem}`) : undefined

/**
 * Fact check (code match, then a model for the rest) and design check (render, measure, a vision
 * model looks at the slides), then one revision that applies both, then a free re-check in code.
 */
/**
 * A revision must not make the facts worse: a slide or caption that had no unsupported figure before, and has one
 * now, goes back to its earlier version (losing that slide's design fix, which matters less than a wrong number).
 */
function keepClean(before: IdeaCard, beforeChecks: FactCheck[], after: IdeaCard, afterChecks: FactCheck[]): IdeaCard {
  const bad = (cs: FactCheck[], slide: number) => cs.some((c) => c.slide === slide && c.status === 'unsupported')
  const out = { ...after }
  if (after.slides.length === before.slides.length) {
    out.slides = after.slides.map((s, i) => (bad(afterChecks, i) && !bad(beforeChecks, i) ? before.slides[i] : s))
  }
  if (bad(afterChecks, -1) && !bad(beforeChecks, -1)) {
    out.caption = before.caption
    out.captionInstagram = before.captionInstagram
  }
  return out
}

export async function checkAndFix(card: IdeaCard, set: Mark): Promise<IdeaCard> {
  const { upsertCard } = getState()
  set('facts', 'running')
  let checks = card.checks ?? []
  try {
    checks = await factCheck(card)
    const bad = checks.filter((c) => c.status === 'unsupported').length
    set('facts', 'done', bad ? `${plural(bad, 'figure')} not in the sources` : `${plural(checks.length, 'figure')} verified`)
  } catch (err) {
    set('facts', 'skipped', (err as Error).message)
  }
  card = { ...card, checks }
  upsertCard(card)

  set('design', 'running')
  let review: DesignReview | null = null
  try {
    const rendered = await renderDeck(card, { images: true })
    review = await reviewDesign(card, rendered)
    set('design', 'done', review.issues.length ? `${plural(review.issues.length, 'issue')} · ${review.score}/10` : `Looks clean · ${review.score}/10`)
  } catch (err) {
    set('design', 'skipped', (err as Error).message)
  }

  const instruction = [fixInstruction(checks), review ? designInstruction(review) : ''].filter(Boolean).join('\n')
  if (!instruction) {
    set('fix', 'skipped', 'Nothing to fix')
    return card
  }
  set('fix', 'running')
  try {
    let { card: next } = await reviseIdea(card, instruction, { silent: true })
    next = keepClean(card, checks, next, recheck(next, checks))
    let after = await renderDeck(next)
    // Problems code can measure get one more targeted pass if the first revision left any.
    const left1 = [...longHeads(next, after).map((h) => `slide ${h.slide + 1}: cut the headline to ≤ ${h.target} words, keeping its number and names`), ...lintTaste(next).map((x) => `${x.slide < 0 ? 'captions' : `slide ${x.slide + 1}`}: ${x.fix}`)]
    if (left1.length) {
      try {
        const { card: again } = await reviseIdea(next, `Change only these and keep everything else exactly as it is: ${left1.join('; ')}.`, { silent: true })
        const kept = keepClean(next, recheck(next, checks), again, recheck(again, checks))
        const afterAgain = await renderDeck(kept)
        const remaining = longHeads(kept, afterAgain).length + lintTaste(kept).length
        if (remaining < left1.length && afterAgain.overflow.length <= after.overflow.length) [next, after] = [kept, afterAgain]
      } catch {
        // Keep the first revision; its leftovers are listed in the design notes.
      }
    }
    const nextChecks = recheck(next, checks)
    const left = nextChecks.filter((c) => c.status === 'unsupported').length
    const fixed: IdeaCard = {
      ...next,
      checks: nextChecks,
      designNotes: notesOf([
        ...after.overflow.map((i) => ({ slide: i, problem: 'text still too long' })),
        ...longHeads(next, after).map((h) => ({ slide: h.slide, problem: `headline still ${h.lines} lines; cut it to ≤ ${h.target} words` })),
        ...lintTaste(next),
      ]),
    }
    upsertCard(fixed)
    set('fix', left || after.overflow.length ? 'error' : 'done', [left && `${plural(left, 'figure')} still unverified`, after.overflow.length && `${plural(after.overflow.length, 'slide')} still crowded`].filter(Boolean).join(' · ') || 'All fixed')
    return fixed
  } catch (err) {
    set('fix', 'error', (err as Error).message)
    // Keep what the reviewer saw so the editor can act on it by hand.
    const notes = notesOf(review?.issues.map((x) => ({ slide: x.slide, problem: `${x.problem} → ${x.fix}` })) ?? [])
    if (notes) {
      card = { ...card, designNotes: notes }
      upsertCard(card)
    }
    return card
  }
}

/** Builds a post straight from a topic typed in chat (no idea card yet). */
export async function buildTopic(topic: string, opts: BuildOptions & { entity?: string }, emit: Emit): Promise<IdeaCard> {
  const format: FormatId = opts.format && FORMAT_IDS.includes(opts.format) ? opts.format : 'quick_take'
  const now = new Date().toISOString()
  const seed: IdeaCard = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    createdAt: now,
    status: 'idea',
    title: topic,
    entity: opts.entity,
    format,
    alternates: routeFormat({
      quantifiable: format === 'guesstimate',
      companySpecific: false,
      decisionTension: false,
      sectorWide: false,
      evergreenConcept: false,
      controversial: false,
      popCulturePeg: false,
      indiaRelevant: true,
      brandSafe: true,
    }).alternates.filter((f) => f !== format),
    routingReason: opts.format ? 'Chosen in conversation' : FORMATS[format].blurb,
    trendRelevance: '',
    audienceRelevance: '',
    engagement: { score: 0, grade: 'C', components: {}, evidence: [] },
    complexity: { level: FORMATS[format].complexity, hours: HOURS_BY_COMPLEXITY[FORMATS[format].complexity], needs: [] },
    hook: '',
    hookVariants: [],
    angle: opts.direction ?? '',
    slides: [],
    caption: '',
    hashtags: [],
    altText: '',
    sources: [],
    origin: 'chat',
  }
  const built = await buildIdea(seed, opts, emit)
  // Ideas typed in chat get the same evidence-based engagement score as scanned ones.
  try {
    const m = await measureTopic(built.title, opts.entity || topic, format, built.sources)
    const sig = m.signals!
    const series = sig.wikiSeries ?? sig.hnSeries
    const scored: IdeaCard = {
      ...getState().cards[built.id],
      engagement: {
        score: m.scores!.engagement,
        grade: m.scores!.grade,
        components: { velocity: sig.velocity, buzz: sig.buzz, breadth: sig.breadth, formatPrior: sig.formatPrior, audienceFit: sig.audienceFit },
        evidence: sig.evidence,
      },
      pace: sig.pace,
      growth: series ? growthRatio(series) : null,
    }
    getState().upsertCard(scored)
    return scored
  } catch {
    return built
  }
}

// ---------- revise ----------

function flattenTree(root: TreeNode) {
  const out: { id: string; parent?: string; label: string; op: string; value?: number; unit?: string }[] = []
  const walk = (n: TreeNode, parent?: string) => {
    const id = `n${out.length + 1}`
    out.push({ id, parent, label: n.label, op: n.op, value: n.op === 'input' ? n.value : undefined, unit: n.unit })
    n.children?.forEach((c) => walk(c, id))
  }
  walk(root)
  return out
}

// Pictures go to the model as their search query only; the image itself stays in code.
const forModel = ({ image: _image, ...s }: SlideSpec) =>
  s.kind === 'tree' ? { kind: 'tree', title: s.title, note: s.note, picture: s.picture, nodes: flattenTree(s.tree) } : s.kind === 'stat' && s.linked ? { ...s, value: '{{ANSWER}}' } : s

/** Keeps each slide's picture through a revision, unless the reviser removed it ("") or asked for a different one. */
function keepPictures(before: SlideSpec[], after: SlideSpec[]): SlideSpec[] {
  return after.map((s, i) => {
    const old = before[i]
    const picture = s.picture === undefined && old?.kind === s.kind ? old.picture : s.picture
    if (!picture) return { ...s, picture, image: undefined }
    const had = before.find((b) => b.image && b.picture === picture)
    return { ...s, picture, image: s.image ?? had?.image }
  })
}

/** Applies an editor's instruction ("make slide 3 punchier", "add a poll") to a built post. */
export async function reviseIdea(card: IdeaCard, instruction: string, opts: { silent?: boolean } = {}): Promise<{ card: IdeaCard; summary: string }> {
  const { brand, upsertCard } = getState()
  const r = await generate({
    role: 'synth',
    temperature: 0.5,
    system: brandSystemPrompt(brand),
    schema: {
      type: 'object',
      properties: {
        slides: { type: 'array', items: SLIDE_SCHEMA },
        caption: { type: 'string' },
        captionInstagram: { type: 'string' },
        hook: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['slides', 'summary'],
    },
    prompt: `Revise this ${FORMATS[card.format].label} post for BGCC.

INSTRUCTION:
${instruction}

CURRENT HOOK: ${card.hook}
CURRENT SLIDES (JSON, numbered from 1 in order):
${JSON.stringify(card.slides.map(forModel), null, 1)}

CURRENT LINKEDIN CAPTION:
${card.caption}

CURRENT INSTAGRAM CAPTION:
${card.captionInstagram ?? ''}

FACT BRIEF (the only facts you may use; copy numbers exactly — never add a figure that isn't in it, and never convert currencies or units):
${(card.brief ?? '').slice(0, 9000)}

${LAYOUT_MENU}

${TASTE_RULES}

Each slide's "picture" is the search for its photo: keep it exactly as it is unless the instruction is about pictures; set it to "none" to remove a picture, or to a new query to change it.

Return the full slide list after the change, in the same JSON shape. Tree slides use "nodes" with id, parent, label, op, value, unit, and a linked stat slide keeps value "{{ANSWER}}". You may switch a slide to a better layout when the instruction calls for it. Change only what the instruction asks for. Return caption, captionInstagram and hook only if they changed. "summary" is one sentence describing what you changed.`,
  })
  const j = r.json ?? {}
  let slides = keepPictures(card.slides, normalizeSlides(Array.isArray(j.slides) ? j.slides : []))
  if (!slides.length) throw new Error('The revision came back empty. Try rephrasing the change.')
  if (slides.some((s) => s.picture && !s.image)) {
    try {
      slides = (await findPictures({ ...card, slides })).card.slides
    } catch {
      // A picture that can't be found now can be searched for again from the editor.
    }
  }
  let next: IdeaCard = {
    ...card,
    slides,
    caption: j.caption || card.caption,
    captionInstagram: j.captionInstagram || card.captionInstagram,
    hook: j.hook || card.hook,
    hookVariants: j.hook && j.hook !== card.hook ? [card.hook, ...card.hookVariants] : card.hookVariants,
  }
  if (next.slides[0]?.kind === 'cover' && j.hook) next.slides[0] = { ...next.slides[0], title: j.hook }
  // Numbers may have changed: re-check them in code (free) against the brief.
  if (card.checks) next = { ...next, checks: recheck(next, card.checks) }
  if (!opts.silent) upsertCard(next)
  return { card: next, summary: j.summary ?? 'Updated the post.' }
}
