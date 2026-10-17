import { PALETTES, PALETTE_IDS, brandSystemPrompt, paletteId, styleId } from './brand'
import { LOOKS } from '../slides/looks'
import { buildIdea, buildTopic, reviseIdea } from './build'
import { generate } from './gemini'
import { ideasForToday } from './pipeline'
import { deepResearch, register, sourceList, webFacts } from './research'
import { FORMATS, FORMAT_IDS } from './scoring'
import { getState, type Prefs } from './store'
import type { ChatPart, FormatId, IdeaCard, PaletteId, SourceRef, StyleId } from './types'
import { learnBrand } from './learn'
import { rewriteHooks } from './writer'

// ---------- tools ----------

const formatParam = { type: 'string', enum: FORMAT_IDS, description: FORMAT_IDS.map((f) => `${f} = ${FORMATS[f].label}`).join('; ') }

export const TOOL_DECLS = [
  {
    name: 'todays_ideas',
    description:
      "Scan today's business news (Google Search sweeps, Indian business press, Hacker News, Google Trends), measure what is gaining momentum, research the strongest stories and return post ideas with every marker (trend relevance, format, audience relevance, engagement potential, complexity, hook, sources). Use when the user asks what to post, for ideas for today, or for ideas on a theme.",
    parameters: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional theme to steer the scan, e.g. "fintech" or "consumer brands"' },
        format: { ...formatParam, description: `Only return ideas in this format. ${formatParam.description}` },
        count: { type: 'number', description: 'How many ideas (default 3, max 5)' },
        fresh: { type: 'boolean', description: 'Force a new scan even if one ran in the last 3 hours' },
      },
    },
  },
  {
    name: 'deep_research',
    description:
      'Thorough, cited research on a question: plans 5 focused Google searches, runs them in parallel, searches again to fill gaps, then writes a cited brief with key figures and 3 post ideas carrying every marker. Takes about a minute. Use for any request to research, dig into, explain or analyse a company, market, deal or trend.',
    parameters: { type: 'object', properties: { question: { type: 'string', description: 'The research question, specific and self-contained' } }, required: ['question'] },
  },
  {
    name: 'web_search',
    description: 'One quick Google Search for a single fact or a quick check. Use deep_research instead for anything that needs analysis.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'read_url',
    description: 'Read a public web page the user shared and summarise what it says.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, question: { type: 'string', description: 'What to look for on the page' } }, required: ['url'] },
  },
  {
    name: 'list_ideas',
    description: 'List recent ideas (suggested and built) with their idea_id, title, format and status. Use to find the id of an idea the user refers to.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'ask_user',
    description:
      'Ask the user one short question with tap-to-answer options, then stop and wait for the answer. kind "look" shows the idea\'s cover rendered in each slide style (Editorial, Bold, Minimal) with colour schemes to pick from (options are ignored; pass idea_id). Use before building a post: first the format, then the look, unless the user already chose them.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: '2–4 short options; put the recommended one first and add " (recommended)"' },
        kind: { type: 'string', enum: ['choice', 'look'] },
        idea_id: { type: 'string', description: 'For kind "look": the idea being built, so its hook is previewed' },
      },
      required: ['question', 'kind'],
    },
  },
  {
    name: 'build_post',
    description:
      'Build a full post: fresh research, 6–9 slides in BGCC style, caption, hashtags, alt text and a senior review. Pass idea_id for an existing idea, or topic for something new.',
    parameters: {
      type: 'object',
      properties: {
        idea_id: { type: 'string' },
        topic: { type: 'string', description: 'For a new idea: the topic with any key facts' },
        format: formatParam,
        palette: { type: 'string', enum: PALETTE_IDS, description: PALETTE_IDS.map((p) => `${p} = ${PALETTES[p].label}`).join('; ') },
        style: { type: 'string', enum: Object.keys(LOOKS), description: 'Slide typography: editorial (serif), bold (heavy sans, big numbers), minimal (quiet sans)' },
        direction: { type: 'string', description: "Editor's angle or style notes, e.g. from a reference post the user attached" },
        entity: { type: 'string', description: 'For a new topic: the main company or concept, 1–3 words' },
      },
    },
  },
  {
    name: 'revise_post',
    description: 'Change a built post: rewrite, add, remove or reorder slides, edit the caption, or change pictures. E.g. "make slide 3 punchier", "add a poll at the end", "put a photo of the founder on the cover", "remove the picture on slide 5".',
    parameters: { type: 'object', properties: { idea_id: { type: 'string' }, instruction: { type: 'string' } }, required: ['idea_id', 'instruction'] },
  },
  {
    name: 'set_palette',
    description: "Change a built post's colour scheme and/or slide style.",
    parameters: { type: 'object', properties: { idea_id: { type: 'string' }, palette: { type: 'string', enum: PALETTE_IDS }, style: { type: 'string', enum: Object.keys(LOOKS) } }, required: ['idea_id'] },
  },
  {
    name: 'learn_brand',
    description:
      "Learn BGCC's tone from real posts: the screenshots attached to this message and/or captions the user pasted. Updates the voice profile every future post is written in.",
    parameters: { type: 'object', properties: { captions: { type: 'string', description: 'Captions or post text the user pasted, verbatim' } } },
  },
  {
    name: 'new_hooks',
    description: 'Write five fresh opening hooks for an idea.',
    parameters: { type: 'object', properties: { idea_id: { type: 'string' }, direction: { type: 'string' } }, required: ['idea_id'] },
  },
]

export const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  todays_ideas: ["Finding today's ideas", "Found today's ideas"],
  deep_research: ['Researching', 'Researched'],
  web_search: ['Searching the web', 'Searched the web'],
  read_url: ['Reading the page', 'Read the page'],
  list_ideas: ['Checking past ideas', 'Checked past ideas'],
  build_post: ['Building the post', 'Built the post'],
  revise_post: ['Revising the post', 'Revised the post'],
  set_palette: ['Changing colours', 'Changed colours'],
  new_hooks: ['Writing new hooks', 'Wrote new hooks'],
  learn_brand: ["Learning BGCC's voice", "Updated BGCC's voice"],
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export const ideaSummary = (c: IdeaCard) => ({
  idea_id: c.id,
  status: c.status,
  title: c.title,
  format: FORMATS[c.format].label,
  alternate_formats: c.alternates.map((f) => FORMATS[f].label),
  hook: c.hook,
  why_now: c.trendRelevance,
  engagement: `${c.engagement.score}/100 (grade ${c.engagement.grade})${c.pace ? `, ${c.pace}` : ''}`,
  complexity: `${c.complexity.level}/5, ~${c.complexity.hours}h`,
  ...(c.status === 'built' ? { slides: c.slides.length, review: c.critique ? `${c.critique.verdict} ${c.critique.score}/10` : undefined } : {}),
})

/** How a tool shows its work in the conversation. Voice passes a no-op. */
/** A run that threw: the step that was running shows as failed, not spinning forever. */
const failed = (p: NonNullable<ChatPart['progress']>) => ({ ...p, done: true, steps: p.steps.map((s) => (s.status === 'running' ? { ...s, status: 'error' as const } : s)) })

export interface ToolUI {
  add: (part: ChatPart) => ChatPart
  emit: () => void
  files?: InlineFile[] // attachments on the current user message
}

export interface ToolOutcome {
  result: Record<string, unknown>
  detail?: string
  followUps?: string[]
  card?: IdeaCard
}

const findCard = (id?: string) => (id ? getState().cards[id] : undefined)

export async function runTool(name: string, args: any, registry: SourceRef[], ui: ToolUI): Promise<ToolOutcome> {
  switch (name) {
    case 'todays_ideas': {
      const part = ui.add({ type: 'progress', progress: { title: args.focus ? `Finding ideas on ${args.focus}` : "Finding today's ideas", steps: [] } })
      const format = FORMAT_IDS.includes(args.format) ? (args.format as FormatId) : undefined
      try {
        const { cards, reused } = await ideasForToday({ focus: args.focus, format, count: args.count, fresh: args.fresh }, (steps) => {
          part.progress = { ...part.progress!, steps }
          ui.emit()
        })
        part.progress = { ...part.progress!, done: true }
        ui.add({ type: 'ideas', cardIds: cards.map((c) => c.id) })
        return {
          result: { reused_recent_scan: reused, ideas: cards.map(ideaSummary), note: 'The idea cards are shown to the user. Do not repeat them.' },
          detail: plural(cards.length, 'idea'),
        }
      } catch (err) {
        part.progress = failed(part.progress!)
        throw err
      }
    }

    case 'deep_research': {
      const part = ui.add({ type: 'research' })
      const run = await deepResearch(String(args.question), registry, (r) => {
        part.research = r
        ui.emit()
      })
      if (run.status === 'error') throw new Error(run.error ?? 'Research failed')
      const ideas = run.ideaIds.map((id) => getState().cards[id]).filter(Boolean)
      return {
        result: {
          brief: run.report.slice(0, 5000),
          figures: run.figures,
          ideas: ideas.map(ideaSummary),
          note: 'The brief, figures and idea cards are shown to the user. Do not repeat them; add at most two sentences.',
        },
        followUps: run.followUps,
        detail: plural(new Set(run.steps.flatMap((s) => s.sourceIds ?? [])).size, 'source'),
      }
    }

    case 'web_search': {
      const part = ui.add({ type: 'tool', tool: { name, label: TOOL_LABELS[name][0], status: 'running', detail: args.query } })
      const cited = await webFacts(
        `Today is ${new Date().toDateString()}. Answer with dense bullet points of specific facts, numbers, dates and names, each with its source: ${args.query}`,
        String(args.query),
        registry,
      )
      part.tool = { ...part.tool!, status: 'done', label: TOOL_LABELS[name][1], detail: `${plural(cited.ids.length, 'source')}${cited.via === 'news' ? ' · headlines' : ''}` }
      return { result: { findings: cited.text, sources: sourceList(registry, cited.ids) } }
    }

    case 'read_url': {
      let host = String(args.url)
      try {
        host = new URL(args.url).hostname.replace(/^www\./, '')
      } catch {
        /* keep raw */
      }
      const part = ui.add({ type: 'tool', tool: { name, label: TOOL_LABELS[name][0], status: 'running', detail: host } })
      const r = await generate({
        role: 'scout',
        urlContext: true,
        temperature: 0.2,
        prompt: `Read ${args.url} and summarise the key facts${args.question ? `, focusing on: ${args.question}` : ''}. Bullet points with numbers and dates.`,
      })
      const n = register(registry, { title: host, url: args.url })
      part.tool = { ...part.tool!, status: 'done', label: TOOL_LABELS[name][1] }
      return { result: { summary: r.text, cite_as: `[${n}]` } }
    }

    case 'list_ideas': {
      const all = Object.values(getState().cards).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { result: { ideas: all.slice(0, Math.min(20, args.limit ?? 12)).map(ideaSummary) } }
    }

    case 'build_post': {
      const existing = findCard(args.idea_id)
      if (args.idea_id && !existing && !args.topic) return { result: { error: 'No idea with that id. Call list_ideas to find it.' } }
      const format = FORMAT_IDS.includes(args.format) ? (args.format as FormatId) : undefined
      const palette = paletteId(args.palette)
      const style = styleId(args.style)
      const part = ui.add({ type: 'progress', progress: { title: existing ? `Building “${existing.title}”` : 'Building the post', steps: [] } })
      const emit = (steps: any) => {
        part.progress = { ...part.progress!, steps }
        ui.emit()
      }
      try {
        const card = existing
          ? await buildIdea(existing, { format, palette, style, direction: args.direction }, emit)
          : await buildTopic(String(args.topic ?? ''), { format, palette, style, direction: args.direction, entity: args.entity }, emit)
        part.progress = { ...part.progress!, done: true }
        ui.add({ type: 'deck', cardId: card.id })
        const latest = getState().cards[card.id] ?? card
        return {
          result: { ...ideaSummary(latest), review_notes: latest.critique?.notes, note: 'The slides are shown to the user. Summarise the review in one or two sentences and offer one concrete improvement.' },
          card: latest,
        }
      } catch (err) {
        part.progress = failed(part.progress!)
        throw err
      }
    }

    case 'revise_post': {
      const card = findCard(args.idea_id)
      if (!card) return { result: { error: 'No idea with that id. Call list_ideas to find it.' } }
      if (card.status !== 'built') return { result: { error: 'That idea has no slides yet. Build it first with build_post.' } }
      const part = ui.add({ type: 'tool', tool: { name, label: TOOL_LABELS[name][0], status: 'running', detail: card.title } })
      const { card: next, summary } = await reviseIdea(card, String(args.instruction))
      part.tool = { ...part.tool!, status: 'done', label: TOOL_LABELS[name][1], detail: summary }
      ui.add({ type: 'deck', cardId: next.id })
      return { result: { summary, slides: next.slides.length }, card: next }
    }

    case 'set_palette': {
      const card = findCard(args.idea_id)
      const p = paletteId(args.palette)
      const st = styleId(args.style)
      if (!card || (!p && !st)) return { result: { error: 'Unknown idea, colour scheme or style.' } }
      getState().patchCard(card.id, { ...(p ? { palette: p } : {}), ...(st ? { style: st } : {}) })
      ui.add({ type: 'deck', cardId: card.id })
      return { result: { ok: true, palette: p && PALETTES[p].label, style: st && LOOKS[st].label } }
    }

    case 'learn_brand': {
      const images = (ui.files ?? []).filter((f) => f.mime.startsWith('image/')).map((f) => ({ mime: f.mime, data: f.data }))
      const texts = (ui.files ?? []).filter((f) => f.text != null).map((f) => f.text)
      const part = ui.add({ type: 'tool', tool: { name, label: TOOL_LABELS[name][0], status: 'running', detail: images.length ? plural(images.length, 'screenshot') : undefined } })
      const { brand, summary } = await learnBrand([args.captions ?? '', ...texts].join('\n\n'), images)
      part.tool = { ...part.tool!, status: 'done', label: TOOL_LABELS[name][1], detail: summary }
      return { result: { summary, voice: brand.voice, hook_patterns: brand.hookPatterns } }
    }

    case 'new_hooks': {
      const card = findCard(args.idea_id)
      if (!card) return { result: { error: 'No idea with that id.' } }
      const part = ui.add({ type: 'tool', tool: { name, label: TOOL_LABELS[name][0], status: 'running', detail: card.title } })
      const hooks = await rewriteHooks(card, getState().brand, args.direction ?? '')
      getState().patchCard(card.id, { hookVariants: [...hooks, ...card.hookVariants].slice(0, 8) })
      part.tool = { ...part.tool!, status: 'done', label: TOOL_LABELS[name][1], detail: plural(hooks.length, 'hook') }
      return { result: { hooks } }
    }
  }
  return { result: { error: `Unknown tool ${name}` } }
}

// ---------- system prompt ----------

export function deskSystemPrompt(mode: 'chat' | 'voice') {
  const { brand } = getState()
  return `${brandSystemPrompt(brand)}

You are BGCC Desk, the club's research and content assistant. You find what is worth posting, research it properly, and build it into posts. Today is ${new Date().toDateString()}.

WHAT TO DO
- "Ideas for today", "what should we post", "give me ideas on X" → call todays_ideas (pass focus for a theme, format if the user wants one format).
- "Research / dig into / what's happening with / explain / analyse X" → call deep_research with a sharp, specific question. Prefer it over web_search for anything beyond a single fact.
- A single quick fact → web_search. A link → read_url.
- The user refers to an idea ("the first one", "the Zepto one") → use the idea_id from earlier tool results, or call list_ideas.
- Only start building when the user asks to build or make a post ("build this", "make the first one"). After ideas or research, just suggest the best pick; never ask build questions unprompted.
- Building a post: if the format hasn't been chosen, call ask_user (kind "choice") with the idea's recommended format first, marked " (recommended)", plus its 1–2 best alternates, using the human format names. Then, if the look (style and colour scheme) hasn't been chosen, call ask_user (kind "look", with idea_id). Ask one question per turn. Then call build_post with idea_id, format, style and palette. The look answer reads like "Bold · BGCC black". If the user attached a reference post, describe its layout and tone in build_post's direction.
- Changing a built post → revise_post. Colours or style → set_palette. Fresh hooks → new_hooks.
- Screenshots or captions of BGCC's own past posts with a request to learn the tone/style → learn_brand. A screenshot of someone else's post as a reference → use it as direction for build_post.
- Never invent numbers. Facts from web_search carry [n] citation markers; keep them exactly as given, right after the fact.
- Tool results with cards, research briefs or slides are already shown to the user. Never repeat them: after build_post or revise_post never write out slides, slide-by-slide outlines or captions. Add one to three sentences at most: the standout pick and why. Questions to the user go through ask_user, never as plain text.
${
  mode === 'chat'
    ? '- Write tight markdown: short paragraphs, bullets for lists, bold for key numbers. No filler, no emoji.\n- Messages may start with [Composer settings …]; follow them: a fixed format means skip the format question, a fixed style and colour scheme means skip the look question; if only one is fixed, still ask the look question.'
    : '- You are speaking aloud as Clay, the desk\'s voice: a yellow hexagon in a little top hat and bowtie with a butler\'s manners, warm and quietly witty. Introduce yourself as Clay if asked. Keep turns short (2–4 sentences), conversational, no lists or markdown. Ask one question at a time. Tell the user that cards and slides appear in the chat.'
}`
}

// ---------- chat loop ----------

export interface InlineFile {
  mime: string
  data: string // base64
  name: string
  text?: string // for plain-text files, the decoded text
}

const settingsLine = (p: Prefs) =>
  `[Composer settings — format: ${FORMATS[p.format as FormatId]?.label ?? 'not chosen'}; style: ${LOOKS[p.style as StyleId]?.label ?? 'not chosen'}; colour scheme: ${PALETTES[p.palette as PaletteId]?.label ?? 'not chosen'}]`

function userParts(text: string, files: InlineFile[], prefs: Prefs): any[] {
  const parts: any[] = [{ text: `${settingsLine(prefs)}\n${text}` }]
  for (const f of files) {
    if (f.text != null) parts.push({ text: `Attached file "${f.name}":\n${f.text.slice(0, 20000)}` })
    else parts.push({ inlineData: { mimeType: f.mime, data: f.data } })
  }
  return parts
}

/** Whether the user picked a format: by answering the format question or by naming one ("make it a guesstimate"). */
function userNamedFormat(contents: any[]) {
  const said = contents
    .filter((c) => c.role === 'user')
    .flatMap((c) => c.parts ?? [])
    .map((p: any) => String(p.text ?? p.functionResponse?.response?.answer ?? ''))
    .join('\n')
    .replace(/^\[Composer settings.*$/gm, '')
    .toLowerCase()
  const names = [...FORMAT_IDS.flatMap((f) => [FORMATS[f].label, FORMATS[f].short]), 'guesstimate', 'framework', 'industry analysis', 'case breakdown', 'case study', 'poll', 'quick take']
  return names.some((n) => said.includes(n.toLowerCase()))
}

/** The model sometimes builds straight away; the format and look are the user's call unless the composer fixed them. */
function unchosen(args: any, prefs: Prefs, contents: any[]) {
  if (prefs.format === 'auto' && !(FORMAT_IDS.includes(args.format) && userNamedFormat(contents)))
    return 'the user has not chosen a format. Call ask_user (kind "choice") with the recommended format marked " (recommended)" and 1–2 alternates, then build with the format they pick.'
  if ((prefs.style === 'ask' && !styleId(args.style)) || (prefs.palette === 'ask' && !paletteId(args.palette)))
    return 'the user has not chosen the look. Call ask_user with kind "look" (and idea_id if there is one), then build with the style and palette they pick.'
  return ''
}

export async function chatTurn(opts: {
  history: any[]
  text: string
  files: InlineFile[]
  prefs: Prefs
  registry: SourceRef[]
  signal?: AbortSignal
  onUpdate: (parts: ChatPart[], followUps: string[]) => void
}): Promise<{ history: any[]; parts: ChatPart[]; followUps: string[] }> {
  const contents = [...opts.history]
  // If the last model turn asked the user something (or was cut off mid-tool), answer those calls first.
  const last = contents[contents.length - 1]
  const pending: any[] = last?.role === 'model' ? (last.parts ?? []).filter((p: any) => p.functionCall).map((p: any) => p.functionCall) : []
  if (pending.length) {
    contents.push({
      role: 'user',
      parts: [
        ...pending.map((fc) => ({
          functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: fc.name === 'ask_user' ? { answer: opts.text } : { skipped: 'The user replied before this ran.' } },
        })),
        ...userParts(opts.text, opts.files, opts.prefs).slice(pending.some((fc) => fc.name === 'ask_user') ? 1 : 0),
      ],
    })
  } else {
    contents.push({ role: 'user', parts: userParts(opts.text, opts.files, opts.prefs) })
  }

  const parts: ChatPart[] = []
  let followUps: string[] = []
  const emit = () => opts.onUpdate(parts.map((p) => ({ ...p })), followUps)
  const ui: ToolUI = {
    files: opts.files,
    add: (p) => {
      parts.push(p)
      emit()
      return p
    },
    emit,
  }

  // Once a deck is on screen, the model sometimes writes the slides out again; keep only its short comment.
  const afterDeck = (t: string) => {
    if (!parts.some((p) => p.type === 'deck')) return t
    const paras = t.split(/\n\s*\n/)
    const cut = paras.findIndex((x) => /^\s*(#|---|\*\*slide|slide \d)/i.test(x))
    return paras.slice(0, Math.min(2, cut < 0 ? 2 : cut)).join('\n\n').trim()
  }

  for (let hop = 0; hop < 8; hop++) {
    if (opts.signal?.aborted) break
    const textPart: ChatPart = { type: 'text', text: '' }
    let shown = false
    const r = await generate({
      role: 'chat',
      system: deskSystemPrompt('chat'),
      contents,
      functions: TOOL_DECLS,
      temperature: 0.5,
      signal: opts.signal,
      onText: (t) => {
        textPart.text = afterDeck(t)
        if (!shown && t.trim()) {
          parts.push(textPart)
          shown = true
        }
        emit()
      },
    })
    contents.push(r.content)
    textPart.text = afterDeck(r.text)
    if (!shown && r.text.trim()) parts.push(textPart)
    emit()
    if (!r.functionCalls.length) break

    // ask_user ends the turn: show the question and wait for the user's reply.
    const ask = r.functionCalls.find((fc) => fc.name === 'ask_user')
    if (ask) {
      const kind = ask.args?.kind === 'look' || ask.args?.kind === 'palette' ? 'look' : 'choice'
      parts.push({
        type: 'ask',
        ask: { question: String(ask.args?.question ?? ''), options: kind === 'look' ? [] : (ask.args?.options ?? []).map(String).slice(0, 4), kind, cardId: ask.args?.idea_id ? String(ask.args.idea_id) : undefined },
      })
      emit()
      break
    }

    const responses: any[] = []
    for (const fc of r.functionCalls) {
      if (opts.signal?.aborted) {
        responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { skipped: 'Stopped by the user.' } } })
        continue
      }
      const missing = fc.name === 'build_post' ? unchosen(fc.args ?? {}, opts.prefs, contents) : ''
      if (missing) {
        responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { error: `Not built yet: ${missing}` } } })
        continue
      }
      try {
        const out = await runTool(fc.name, fc.args ?? {}, opts.registry, ui)
        if (out.followUps?.length) followUps = out.followUps
        responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: out.result } })
      } catch (err) {
        const message = (err as Error).message
        parts.push({ type: 'tool', tool: { name: fc.name, label: `${TOOL_LABELS[fc.name]?.[0] ?? fc.name} failed`, status: 'error', detail: message } })
        responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { error: message } } })
      }
      emit()
    }
    contents.push({ role: 'user', parts: responses })
  }
  return { history: trimHistory(contents), parts, followUps }
}

/** Keep the last ~10 user text turns so prompts stay small; cut only at a user text turn. Drops old attachments. */
function trimHistory(contents: any[]): any[] {
  const starts = contents
    .map((c, i) => (c.role === 'user' && c.parts?.some((p: any) => typeof p.text === 'string') && !c.parts.some((p: any) => p.functionResponse) ? i : -1))
    .filter((i) => i >= 0)
  const kept = starts.length > 10 ? contents.slice(starts[starts.length - 10]) : contents
  const recent = starts.length ? starts[starts.length - 1] - (contents.length - kept.length) : -1
  return kept.map((c, i) =>
    i < recent && c.parts?.some((p: any) => p.inlineData) ? { ...c, parts: c.parts.map((p: any) => (p.inlineData ? { text: '[attachment removed to save space]' } : p)) } : c,
  )
}
