// Design taste for the slide agent, adapted from taste-skill (github.com/Leonxlnx/taste-skill, MIT):
// its copy tells, its critique passes and its scoring with caps, rewritten for a 1080×1350 carousel.
// Motion, photography and web-page rules are left out: the layouts are fixed and drawn by code.
import type { IdeaCard, SlideSpec } from './types'

/** Copy rules for the writer and the reviser. */
export const TASTE_RULES = `TASTE RULES (copy that reads as generated loses the reader in one swipe):
1. One idea per slide, and one dominant element: the number, the chart or the headline. Never two things fighting to lead.
2. Headlines are titles, not paragraphs: about 8 words, two lines (the cover may take four at its display size). When cutting, keep the number, the name and the tension; cut the filler. Short is not the goal: "Competition intensifies" is worse than "Blinkit loses ₹3 an order; Instamart loses ₹80". The cover always carries the story's sharpest number or tension.
   Tables carry only figures the brief has: never an "N/A" cell.
3. Use the count the content has. Do not force three points, three steps or three stats when the brief has two or five.
4. Banned words: unlock, unleash, supercharge, seamless, elevate, empower, revolutionise, game-changer, cutting-edge, next-gen, world-class, all-in-one, effortless, reimagine, delve, tapestry, leverage, synergy, streamline, robust, holistic, "in today's …", "the future of …", "not just X, it's Y", "more than just". Say the specific thing.
5. No emoji on slides. At most one em dash per slide; use a full stop.
6. No labels that narrate the design or pretend to be editorial ("Key takeaways", "The breakdown", "Deep dive", "Step 1:" in front of a step). Say the point.
7. Consecutive slides must look different: never three slides in a row with the same layout.
8. Every line could only be about this story. If swapping the company name would leave a slide equally true, rewrite it with this story's number, name or decision.
9. No social-media openers or closers: "Ever wondered", "Did you know", "Here's why", "Let's dive in", "Buckle up", "Swipe to …", "Share your thoughts", "Drop a comment". The cover states the number or the tension outright; the closing asks one specific question.
10. Headlines in sentence case (capitalise the first word and names only). No exclamation marks or hashtags on slides.`

const STOCK = /\b(unlock(s|ed|ing)?|unleash(es|ed|ing)?|supercharg(e|es|ed|ing)|seamless(ly)?|elevat(e|es|ed|ing)|empower(s|ed|ing)?|revolutioni[sz](e|es|ed|ing)|game[- ]chang(er|ers|ing)|cutting[- ]edge|next[- ]gen(eration)?|world[- ]class|best[- ]in[- ]class|all[- ]in[- ]one|effortless(ly)?|reimagin(e|ed|ing)|delve|tapestry|leverag(e|es|ed|ing)|synerg(y|ies)|streamlin(e|es|ed|ing)|robust|holistic|turbocharg(e|ed)|in today['’]?s|the future of|take .{1,30} to the next level|not just .{1,40}?[,;—–-]\s*(it['’]?s|but)|more than just)\b/gi
const EMOJI = /\p{Extended_Pictographic}/u
const LABELS = /^(key takeaways?|the breakdown|deep dive|the details|the bottom line|let['’]?s break it down|step \d+:?|phase \d+:?)\b/i
const CLICHE = /\b(ever wondered|did you know|here['’]?s (why|how|what)|let['’]?s dive|dive in(to)?|buckle up|you won['’]?t believe|swipe (to|left|right|through)|share your thoughts|drop (a|your) (comment|thoughts)|thoughts\?)/gi
// A source named in slide text; the footer credits sources, so the body never should.
const CITED = /\(([^)]*\.(com|in|org|net|co)\b[^)]*|[^)]*\b(Times|Mint|Standard|Reuters|Bloomberg|Moneycontrol|Inc42|Outlook|Forbes|YourStory|Entrackr|Tracxn|Business)\b[^)]*)\)/
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
/** "Zepto's Revenue Surges Amidst Losses": most longer words after the first are capitalised. */
const titleCase = (h: string) => {
  const long = h.split(/\s+/).slice(1).filter((w) => /^[A-Za-z][a-z]{3,}/.test(w))
  return long.length >= 3 && long.filter((w) => /^[A-Z]/.test(w)).length / long.length >= 0.75
}

/** Every piece of text on a slide, headline first. */
function texts(s: SlideSpec): { head: string; rest: string[] } {
  const r: string[] = []
  const add = (...xs: (string | undefined)[]) => xs.forEach((x) => x && r.push(x))
  switch (s.kind) {
    case 'cover': add(s.subtitle); return { head: s.title, rest: r }
    case 'statement': add(s.body); return { head: s.title, rest: r }
    case 'bullets': add(...s.points); return { head: s.title, rest: r }
    case 'stat': add(s.label, s.context); return { head: '', rest: r }
    case 'kpis': add(...s.items.map((i) => i.label)); return { head: s.title, rest: r }
    case 'chart': return { head: s.title, rest: r }
    case 'compare': add(s.verdict, ...s.left.points, ...s.right.points); return { head: s.title, rest: r }
    case 'timeline': add(...s.events.map((e) => e.text)); return { head: s.title, rest: r }
    case 'quote': return { head: '', rest: r }
    case 'table': return { head: s.title, rest: r }
    case 'ranked': add(...s.items.map((i) => i.note)); return { head: s.title, rest: r }
    case 'diagram': add(...s.items.map((i) => i.desc)); return { head: s.title, rest: r }
    case 'steps': add(...s.steps.flatMap((x) => [x.title, x.body])); return { head: s.title, rest: r }
    case 'matrix': add(...s.quadrants.flatMap((q) => [q.title, q.body])); return { head: s.title, rest: r }
    case 'tree': return { head: s.title, rest: r }
    case 'poll': add(...s.options); return { head: s.question, rest: r }
    case 'closing': add(s.cta); return { head: s.title, rest: r }
    default: return { head: '', rest: r }
  }
}

export interface TasteIssue {
  slide: number // 0-based; -1 for the captions
  problem: string
  fix: string
}

/** Code checks for the tells a model reliably produces. Free: no model call. */
export function lintTaste(card: Pick<IdeaCard, 'slides' | 'caption' | 'captionInstagram'>): TasteIssue[] {
  const out: TasteIssue[] = []
  card.slides.forEach((s, i) => {
    const { head, rest } = texts(s)
    const all = [head, ...rest].join(' \n ')
    const stock = [...new Set((all.match(STOCK) ?? []).map((m) => m.toLowerCase()))]
    if (stock.length) out.push({ slide: i, problem: `Stock phrasing: ${stock.map((m) => `"${m}"`).join(', ')}`, fix: `Replace ${stock.map((m) => `"${m}"`).join(', ')} with the specific fact or action` })
    const limit = s.kind === 'cover' ? 14 : 12
    if (head && words(head) > limit) out.push({ slide: i, problem: `Headline is ${words(head)} words and will run past two lines`, fix: `Cut the headline to ≤ ${limit - 2} words; move the rest into the body` })
    if (EMOJI.test(all)) out.push({ slide: i, problem: 'Emoji on a slide', fix: 'Remove the emoji; say it in words' })
    if ((all.match(/—/g) ?? []).length > 1) out.push({ slide: i, problem: 'Several em dashes', fix: 'Replace the em dashes with full stops' })
    const cliche = [...new Set((all.match(CLICHE) ?? []).map((m) => m.toLowerCase()))]
    if (cliche.length) out.push({ slide: i, problem: `Social-media cliché: ${cliche.map((m) => `"${m}"`).join(', ')}`, fix: s.kind === 'cover' ? 'Rewrite the headline to state the number or the tension outright, not as a teaser question' : `Cut ${cliche.map((m) => `"${m}"`).join(', ')}; ask or state the specific thing` })
    if (head && titleCase(head)) out.push({ slide: i, problem: 'Headline in Title Case', fix: 'Set the headline in sentence case: capitalise only the first word and names' })
    if (/[!#]/.test(all)) out.push({ slide: i, problem: 'Exclamation mark or hashtag on the slide', fix: 'Remove exclamation marks and hashtags from the slide text' })
    const cited = all.match(CITED)
    if (cited) out.push({ slide: i, problem: `Source named in slide text: "${cited[0]}"`, fix: `Delete "${cited[0]}" from the slide; the footer credits the source` })
    if (s.kind === 'table' && s.rows.some((r) => r.some((x) => /^\s*(n\/?a|-|—|tbd|unknown)?\s*$/i.test(x)))) {
      out.push({ slide: i, problem: 'Table has empty or "N/A" cells', fix: 'Drop the rows or columns the brief has no figure for, or switch to a compare slide' })
    }
    const label = [head, ...rest].find((t) => LABELS.test(t.trim()))
    if (label) out.push({ slide: i, problem: `Filler label "${label.trim().slice(0, 40)}"`, fix: 'Delete the label and state the point itself' })
  })
  // Three of the same layout in a row reads as a template.
  for (let i = 2; i < card.slides.length; i++) {
    const k = card.slides[i].kind
    if (k === card.slides[i - 1].kind && k === card.slides[i - 2].kind) {
      out.push({ slide: i, problem: `Third "${k}" slide in a row`, fix: 'Switch this slide to a different layout that suits its content' })
    }
  }
  const caps = [card.caption, card.captionInstagram ?? ''].join('\n')
  const capStock = [...new Set((caps.match(STOCK) ?? []).map((m) => m.toLowerCase()))]
  if (capStock.length) out.push({ slide: -1, problem: `Stock phrasing in the captions: ${capStock.map((m) => `"${m}"`).join(', ')}`, fix: `In the captions, replace ${capStock.map((m) => `"${m}"`).join(', ')} with the specific fact` })
  const capCliche = [...new Set((caps.match(CLICHE) ?? []).map((m) => m.toLowerCase()))]
  if (capCliche.length) out.push({ slide: -1, problem: `Social-media cliché in the captions: ${capCliche.map((m) => `"${m}"`).join(', ')}`, fix: `In the captions, cut ${capCliche.map((m) => `"${m}"`).join(', ')} and say the specific thing` })
  if ((caps.match(/—/g) ?? []).length > 3) out.push({ slide: -1, problem: 'Em-dash habit in the captions', fix: 'In the captions, replace most em dashes with full stops' })
  return out
}

/** The vision reviewer's method: separate passes on the rendered slides, then a weighted score with caps. */
export const CRITIQUE = `Look at the slides, not at what they were meant to be. Make each pass on its own:
1. One second: glance at each slide. There should be exactly one thing you saw (a number, a chart, a headline). If the answer is "a slide with text", it has no focal point.
2. Squint: each slide should reduce to two or three masses with clear size differences. Many similar-sized blocks means nothing leads.
3. Anyone's post?: cover the BGCC mark. If another club could post this cover unchanged about a different company, the hook has no idea.
4. Space: a region empty by accident (a hole beside a short column, a chart floating in a big field) versus a deliberate rest. Crammed slides too.
5. Type: headlines of three or more lines, orphan words, text too small to read on a phone (under about 22px at full size).
6. Colour: the accent should mark the one thing that matters on a slide (the key bar, the winning number). Accent on everything means nothing.
7. Sameness: name each slide's layout in one word. The same word three times in a row is the template showing.
8. Substance: does each slide deliver its information completely? Would the reader leave knowing the story's number and the decision?
9. Collisions: clipped or overlapping text, anything over a headline, a chart label cut off.
10. Pictures: is each photo doing a job (showing the company, the person, the place the slide is about)? A photo of the wrong company, a logo, a blurry or watermarked image, or one that makes the text hard to read is worse than none: the fix is "remove the picture" (set picture to "none") or a better search ("picture: Blinkit dark store interior"). A deck about real companies with no picture of them at all is a missed chance on the cover.

Score each criterion 1–10, as a juror who did not make it:
- design (40%): hierarchy, composition, type, colour. 7 = clean and professional; 6 = tidy but anonymous, reads as a kit.
- readability (30%): takeaway within 3 seconds per slide, readable on a phone, charts easy to read.
- idea (20%): a take specific to this story, carried from the cover through the closing.
- content (10%): specific, edited words; numbers on the slides, not adjectives.
overall = 0.4·design + 0.3·readability + 0.2·idea + 0.1·content. Most good carousels land at 7–8; an honest 9 is rare.
Caps, which override the arithmetic: any clipped or overlapping text → readability ≤ 5. A body-slide headline of three or more lines → overall ≤ 6.5 (the cover is a poster and may take four lines; do not ask to shorten a cover that fits in four). Headlines so generic they could sit on any post ("Competition intensifies") → idea ≤ 6, and the fix names the number or decision to put in. Three similar-looking slides in a row → design ≤ 6.5. Cover that could belong to anyone (pass 3) → idea ≤ 6. A list of numbers that should have been a chart → design ≤ 7.`
