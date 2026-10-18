import type { CSSProperties, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { BrandProfile, SlideSpec, StyleId, TreeNode } from '../lib/types'
import { BACKDROP_KINDS, PANEL_KINDS } from '../lib/images'
import { computeTree, formatIndian } from '../lib/writer'
import { Diagram } from './Diagram'
import { LOOKS, SERIF, type Look } from './looks'

export const SLIDE_W = 1080
export const SLIDE_H = 1350

/** Shrinks type for long strings before layout; the fit pass below handles the rest. */
const fit = (text: string | undefined, base: number, comfortable: number) =>
  Math.round(base * Math.min(1, Math.sqrt(comfortable / Math.max(1, (text ?? '').length))))
// For text that must stay on one line (big numbers): shrink in proportion to its length.
const fitLine = (text: string | undefined, base: number, comfortable: number) => Math.round(base * Math.min(1, comfortable / Math.max(1, (text ?? '').length)))
// Writers often number step titles themselves; the layout already shows the number.
const unnumber = (t: string) => t.replace(/^\s*(step\s*)?\d+\s*[.):-]\s*/i, '')

interface Props {
  slide: SlideSpec
  index: number
  total: number
  brand: BrandProfile
  style?: StyleId
  source?: string
}

const MIN_K = 0.66
const MAX_K = 1.3

export function Slide({ slide, index, total, brand, style = 'editorial', source }: Props) {
  const look = LOOKS[style]
  const pal = brand.palette
  // A photo sits behind the text on single-idea layouts, darkened, so they render like the cover; others get a band.
  const backdrop = slide.image && BACKDROP_KINDS.has(slide.kind) ? slide.image : undefined
  const band = slide.image && PANEL_KINDS.has(slide.kind) ? slide.image : undefined
  const dark = Boolean(pal.allDark) || slide.kind === 'cover' || slide.kind === 'closing'
  // On an all-dark deck, or over a photo, body slides swap ink and paper so every element stays legible.
  const flip = (Boolean(pal.allDark) || Boolean(backdrop)) && slide.kind !== 'cover' && slide.kind !== 'closing'
  const ink = flip ? pal.paper : pal.ink
  const paper = flip ? pal.ink : pal.paper
  const muted = backdrop ? `${pal.paper}D0` : flip ? '#A1A1AA' : pal.muted
  const accent = pal.accent
  const fg = flip ? ink : dark ? paper : ink
  const sub = flip ? muted : dark ? `${paper}B3` : muted
  const bg = flip ? paper : dark ? ink : paper

  // Type is fitted to the slide after layout, before paint: scaled down while it overflows, or up while a sparse
  // slide leaves much of its area empty (a 4-row table shouldn't sit in the top half).
  const bodyRef = useRef<HTMLDivElement>(null)
  // The picture enters the signature by identity, not by its (large) data URL.
  const sig = JSON.stringify({ ...slide, image: slide.image ? slide.image.origin ?? slide.image.src.length : undefined }) + style
  const [fitState, setFitState] = useState({ sig, k: 1, dir: 0 })
  const fresh = fitState.sig === sig
  const k = fresh ? fitState.k : 1
  const dir = fresh ? fitState.dir : 0
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const over = el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2
    const step = (n: number) => Math.round(n * 100) / 100
    // Measuring layout is what this effect is for; each step re-renders once until the size settles.
    /* eslint-disable react/set-state-in-effect */
    if (over) {
      // Growing went one step too far: settle on the last size that fit.
      if (dir > 0) setFitState({ sig, k: step(k - 0.06), dir: 2 })
      else if (k > MIN_K) setFitState({ sig, k: Math.max(MIN_K, step(k - 0.06)), dir: -1 })
    } else if (dir === 0 || dir === 1) {
      if (k < MAX_K && emptyShare(el) > 0.2) setFitState({ sig, k: step(k + 0.06), dir: 1 })
    }
    /* eslint-enable react/set-state-in-effect */
    el.dataset.overflow = over && k <= MIN_K ? '1' : ''
    el.dataset.k = String(k)
  }, [sig, k, dir])

  const frame: CSSProperties = {
    width: SLIDE_W,
    height: SLIDE_H,
    background: bg,
    color: fg,
    fontFamily: look.body,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    padding: '84px 92px 76px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  }

  const kicker = slide.kind === 'cover' ? slide.kicker : KICKER[slide.kind]
  const ctx: Ctx = { ink, accent, paper, muted, look, k, dark: dark || flip, style }

  return (
    <div style={frame} data-slide-index={index}>
      {backdrop && (
        <>
          <img src={backdrop.src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* A flat wash of the deck's ink keeps white type legible on any photo. */}
          <div style={{ position: 'absolute', inset: 0, background: pal.ink, opacity: slide.kind === 'cover' ? 0.58 : 0.76 }} />
          {backdrop.credit && (
            <span style={{ position: 'absolute', right: 34, bottom: 150, writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 15, color: `${pal.paper}99`, whiteSpace: 'nowrap', maxHeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{backdrop.credit}</span>
          )}
        </>
      )}
      <header style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 60 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: look.mark, fontWeight: look.markWeight, fontSize: 34, letterSpacing: style === 'bold' ? '-0.02em' : '-0.01em' }}>BGCC</span>
          <span style={{ width: 11, height: 11, background: accent, display: 'inline-block', borderRadius: style === 'minimal' ? 99 : 0 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 21, letterSpacing: '0.14em', textTransform: 'uppercase', color: sub, fontWeight: 600 }}>
          {kicker && style === 'bold' && slide.kind === 'cover' ? (
            <span style={{ background: accent, color: pal.ink, padding: '6px 14px', letterSpacing: '0.1em', fontWeight: 800 }}>{kicker}</span>
          ) : (
            <span style={{ color: dark ? accent : sub }}>{kicker}</span>
          )}
          <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}>
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>
      </header>

      {band && (
        <div style={{ position: 'relative', height: 360, margin: '-24px -92px 48px', flexShrink: 0, overflow: 'hidden' }}>
          <img src={band.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {band.credit && (
            <span style={{ position: 'absolute', right: 16, bottom: 12, fontSize: 15, color: '#fff', background: '#0009', padding: '3px 8px', maxWidth: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{band.credit}</span>
          )}
        </div>
      )}
      <div ref={bodyRef} data-body style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <Body slide={slide} c={ctx} />
      </div>

      <footer
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `${style === 'minimal' ? 1 : 2}px solid ${flip ? `${ink}26` : dark ? `${paper}26` : `${ink}1A`}`,
          paddingTop: 26,
          marginTop: 36,
          fontSize: 22,
          color: sub,
        }}
      >
        <span style={{ fontWeight: 600 }}>{brand.handle}</span>
        <span style={{ maxWidth: 620, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {index < total - 1 ? (source && slide.kind !== 'cover' ? `Source: ${source}` : 'Swipe →') : 'Save this for your next case'}
        </span>
      </footer>
    </div>
  )
}

/** Share of the body's height its content leaves empty. Layouts that stretch to fill report about zero. */
function emptyShare(body: HTMLElement) {
  const root = body.firstElementChild as HTMLElement | null
  if (!root || !root.children.length) return 0
  const box = root.getBoundingClientRect()
  if (!box.height) return 0
  let topmost = Infinity
  let bottom = -Infinity
  for (const ch of root.children) {
    const r = ch.getBoundingClientRect()
    topmost = Math.min(topmost, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  return 1 - (bottom - topmost) / box.height
}

const KICKER: Record<SlideSpec['kind'], string> = {
  cover: '',
  statement: 'Context',
  bullets: 'Analysis',
  stat: 'By the numbers',
  tree: 'Assumption tree',
  matrix: 'Framework',
  steps: 'Structure',
  poll: 'Your call',
  closing: 'Takeaway',
  chart: 'The data',
  kpis: 'By the numbers',
  compare: 'Head to head',
  timeline: 'How it unfolded',
  quote: 'In their words',
  table: 'The numbers',
  ranked: 'The ranking',
  diagram: 'Framework',
}

interface Ctx {
  ink: string
  accent: string
  paper: string
  muted: string
  look: Look
  k: number
  dark: boolean
  style: StyleId
}

function Title({ children, size, c, color }: { children: ReactNode; size: number; c: Ctx; color?: string }) {
  return (
    <h2
      data-head
      style={{
        fontFamily: c.look.head,
        fontWeight: c.look.headWeight,
        fontSize: Math.round(size * c.k * c.look.headScale),
        lineHeight: c.look.headLead,
        letterSpacing: c.look.headTrack,
        margin: 0,
        color,
        textWrap: 'balance',
      }}
    >
      {children}
    </h2>
  )
}

/** Accent rule: a bar for editorial, a heavy block for bold, a hairline for minimal. */
function Rule({ c, w = 96, my = 0 }: { c: Ctx; w?: number; my?: number }) {
  const h = c.style === 'bold' ? 14 : c.style === 'minimal' ? 3 : 8
  return <div style={{ width: c.style === 'minimal' ? w * 0.6 : w, height: h, background: c.accent, margin: `${my}px 0`, flexShrink: 0 }} />
}

const fmtNum = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : (Math.round(v * 10) / 10).toLocaleString('en-IN'))
/** Puts a currency symbol before its number: the model sometimes writes "90 $B" or "52,878 ₹ crore". */
export const tidyMoney = (s: string) => s.replace(/(\d[\d.,]*)\s*([₹$€£])(?!\s*\d)\s*([A-Za-z]{0,6})(?![A-Za-z])/g, (_m, n, sym, u) => `${sym}${n}${u ? (u.length <= 2 ? u : ` ${u}`) : ''}`)

const withUnit = (v: number, unit?: string) => {
  if (!unit) return fmtNum(v)
  const money = unit.match(/^([₹$€£])\s*(.*)$/)
  if (money) return `${money[1]}${fmtNum(v)}${money[2] ? (money[2].length <= 2 ? money[2] : ` ${money[2]}`) : ''}`
  if (unit === '₹' || unit === '$') return `${unit}${fmtNum(v)}`
  if (unit === '%' || unit === '×' || unit === 'x') return `${fmtNum(v)}${unit}`
  return `${fmtNum(v)} ${unit}`
}

function Body({ slide, c }: { slide: SlideSpec; c: Ctx }) {
  const { ink, accent, paper, muted, look, k } = c
  const z = (n: number) => Math.round(n * k)
  const center: CSSProperties = { display: 'flex', flexDirection: 'column', justifyContent: 'safe center', flex: 1 }
  const top: CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1 }
  switch (slide.kind) {
    case 'cover':
      return (
        <div style={{ ...center, justifyContent: c.style === 'bold' ? 'flex-end' : 'safe center', paddingBottom: c.style === 'bold' ? 40 : 0 }}>
          {c.style !== 'bold' && <Rule c={c} my={0} />}
          <div style={{ height: c.style === 'bold' ? 0 : 48 }} />
          <Title size={fit(slide.title, c.style === 'bold' ? 112 : 96, 60)} c={c}>
            {slide.title}
          </Title>
          {c.style === 'bold' && <Rule c={c} w={180} my={44} />}
          {slide.subtitle && (
            <p style={{ fontSize: z(fit(slide.subtitle, 36, 110)), lineHeight: 1.4, marginTop: c.style === 'bold' ? 0 : 40, color: `${paper}C0`, maxWidth: 820 }}>{slide.subtitle}</p>
          )}
        </div>
      )
    case 'statement':
      return (
        <div style={{ ...center, gap: z(44) }}>
          <Title size={fit(slide.title, 68, 70)} c={c}>
            {slide.title}
          </Title>
          <Rule c={c} w={72} />
          <p style={{ fontSize: z(fit(slide.body, 38, 200)), lineHeight: 1.5, color: muted, margin: 0 }}>{slide.body}</p>
        </div>
      )
    case 'bullets': {
      const longest = Math.max(...slide.points.map((p) => p.length), 1)
      const size = z(Math.min(40, fit('x'.repeat(longest * slide.points.length), 40, 420)))
      return (
        <div style={top}>
          <Title size={fit(slide.title, 60, 70)} c={c}>
            {slide.title}
          </Title>
          <ol style={{ listStyle: 'none', padding: 0, margin: `${z(56)}px 0 0`, display: 'flex', flexDirection: 'column', gap: z(40) }}>
            {slide.points.map((p, i) => (
              <li key={i} style={{ display: 'flex', gap: 30, alignItems: 'baseline' }}>
                <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: size + 4, color: accent, minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: size, lineHeight: 1.42, color: ink }}>{p}</span>
              </li>
            ))}
          </ol>
        </div>
      )
    }
    case 'stat':
      return (
        <div style={center}>
          <div style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(fitLine(tidyMoney(slide.value), c.style === 'bold' ? 220 : 190, 7)), lineHeight: 1, color: accent, letterSpacing: look.numTrack, whiteSpace: 'nowrap' }}>
            {tidyMoney(slide.value)}
          </div>
          <p style={{ fontFamily: look.head, fontWeight: look.headWeight, fontSize: z(fit(slide.label, 50, 60)), lineHeight: 1.2, margin: `${z(44)}px 0 0`, letterSpacing: look.headTrack }}>{slide.label}</p>
          {slide.context && <p style={{ fontSize: z(fit(slide.context, 32, 160)), lineHeight: 1.5, color: muted, marginTop: z(30) }}>{slide.context}</p>}
        </div>
      )
    case 'tree': {
      const tree: TreeNode = JSON.parse(JSON.stringify(slide.tree))
      computeTree(tree)
      const count = countNodes(tree)
      const row = z(count > 9 ? 28 : 34)
      return (
        <div style={top}>
          <Title size={fit(slide.title, 54, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ marginTop: z(52), display: 'flex', flexDirection: 'column', gap: z(count > 9 ? 14 : 22) }}>
            <TreeRows node={tree} depth={0} size={row} c={c} />
          </div>
          {slide.note && <p style={{ marginTop: 'auto', paddingTop: 20, fontSize: z(23), color: muted, lineHeight: 1.45 }}>{slide.note}</p>}
        </div>
      )
    }
    case 'matrix':
      return (
        <div style={top}>
          <Title size={fit(slide.title, 54, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ display: 'flex', flex: 1, marginTop: z(52), gap: 22, minHeight: 0 }}>
            <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 22, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, fontWeight: 600, textAlign: 'center' }}>{slide.yAxis} →</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 4, background: `${ink}22` }}>
                {slide.quadrants.map((q, i) => (
                  <div key={i} style={{ background: i === 1 ? mix(paper, accent, 0.1) : paper, padding: '30px 30px' }}>
                    <div style={{ fontWeight: 700, fontSize: z(fit(q.title, 30, 26)), color: i === 1 ? accent : ink, marginBottom: 12 }}>{q.title}</div>
                    <div style={{ fontSize: z(fit(q.body, 24, 90)), lineHeight: 1.42, color: muted }}>{q.body}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 22, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, fontWeight: 600, textAlign: 'center' }}>{slide.xAxis} →</div>
            </div>
          </div>
        </div>
      )
    case 'steps': {
      const n = slide.steps.length
      const body = z(n > 4 ? 27 : 31)
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <ol style={{ listStyle: 'none', padding: 0, margin: `${z(52)}px 0 0`, display: 'flex', flexDirection: 'column', gap: z(n > 4 ? 24 : 34) }}>
            {slide.steps.map((s, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', borderTop: `2px solid ${ink}14`, paddingTop: z(n > 4 ? 20 : 28) }}>
                <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(46), color: accent, lineHeight: 1 }}>{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: body + 6, marginBottom: 8 }}>{unnumber(s.title)}</div>
                  <div style={{ fontSize: z(fit(s.body, body, 120)), lineHeight: 1.45, color: muted }}>{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )
    }
    case 'poll':
      return (
        <div style={center}>
          <Title size={fit(slide.question, 66, 70)} c={c}>
            {slide.question}
          </Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: z(22), marginTop: z(64) }}>
            {slide.options.map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 28, border: `${c.style === 'minimal' ? 1.5 : 2.5}px solid ${ink}`, borderRadius: c.style === 'minimal' ? 16 : 0, padding: `${z(26)}px 32px` }}>
                <span style={{ width: 54, height: 54, border: `2.5px solid ${accent}`, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 26, color: accent, flexShrink: 0 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span style={{ fontSize: z(fit(o, 34, 60)), fontWeight: 500, lineHeight: 1.3 }}>{o}</span>
              </div>
            ))}
          </div>
          <p style={{ marginTop: z(44), fontSize: z(26), color: muted }}>Comment your letter, and your reasoning.</p>
        </div>
      )
    case 'closing':
      return (
        <div style={center}>
          <Title size={fit(slide.title, 74, 70)} c={c}>
            {slide.title}
          </Title>
          <Rule c={c} my={z(52)} />
          <p style={{ fontSize: z(fit(slide.cta, 36, 120)), lineHeight: 1.45, color: `${paper}C8`, margin: 0 }}>{slide.cta}</p>
        </div>
      )
    case 'chart':
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'safe center', marginTop: z(44) }}>
            <Chart slide={slide} c={c} />
          </div>
          {slide.note && <p style={{ fontSize: z(23), color: muted, lineHeight: 1.45, marginTop: 20 }}>{slide.note}</p>}
        </div>
      )
    case 'kpis': {
      const n = slide.items.length
      // Three in a 2-column grid leaves a hole under the third, so three stack in one column.
      const cols = n <= 3 ? 1 : 2
      const valueSize = n === 3 ? 118 : cols === 1 ? 150 : 96
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: z(28), marginTop: z(52) }}>
            {slide.items.map((it, i) => (
              <div key={i} style={{ background: c.style === 'minimal' ? 'transparent' : mix(paper, ink, 0.06), borderTop: c.style === 'minimal' ? `1.5px solid ${ink}33` : 'none', borderRadius: c.style === 'bold' ? 0 : c.style === 'minimal' ? 0 : 18, padding: c.style === 'minimal' ? `${z(28)}px 0 0` : `${z(36)}px ${z(36)}px` }}>
                <div style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(fitLine(tidyMoney(it.value), valueSize, cols === 1 ? 7 : 6)), lineHeight: 1, color: accent, letterSpacing: look.numTrack, whiteSpace: 'nowrap' }}>{tidyMoney(it.value)}</div>
                <div style={{ fontSize: z(fit(it.label, 30, 50)), lineHeight: 1.35, marginTop: z(18), color: ink }}>{it.label}</div>
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'compare': {
      const side = (s: typeof slide.left, i: number) => (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: z(22), padding: c.style === 'minimal' ? 0 : `${z(34)}px ${z(32)}px`, background: c.style === 'minimal' ? 'transparent' : i === 0 ? mix(paper, accent, 0.1) : mix(paper, ink, 0.06), borderRadius: c.style === 'editorial' ? 14 : 0 }}>
          <div style={{ fontFamily: look.head, fontWeight: look.headWeight, fontSize: z(fit(s.name, 44, 14)), letterSpacing: look.headTrack, color: i === 0 ? accent : ink, lineHeight: 1.1 }}>{s.name}</div>
          {s.stat && (
            <div>
              <div style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(fitLine(s.stat, 76, 7)), lineHeight: 1, letterSpacing: look.numTrack, whiteSpace: 'nowrap' }}>{s.stat}</div>
              {s.statLabel && <div style={{ fontSize: z(22), color: muted, marginTop: 8, lineHeight: 1.3 }}>{s.statLabel}</div>}
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: z(16) }}>
            {s.points.map((p, j) => (
              <li key={j} style={{ fontSize: z(fit(p, 27, 60)), lineHeight: 1.38, color: ink, paddingLeft: 22, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, top: '0.55em', width: 9, height: 9, background: i === 0 ? accent : muted, borderRadius: 99 }} />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ display: 'flex', gap: z(c.style === 'minimal' ? 56 : 22), marginTop: z(48), position: 'relative' }}>
            {side(slide.left, 0)}
            {c.style === 'minimal' && <div style={{ width: 1.5, background: `${ink}22` }} />}
            {side(slide.right, 1)}
          </div>
          {slide.verdict && (
            <p style={{ marginTop: z(30), fontSize: z(fit(slide.verdict, 30, 90)), lineHeight: 1.4, fontWeight: 600, borderLeft: `6px solid ${accent}`, paddingLeft: 22 }}>{slide.verdict}</p>
          )}
        </div>
      )
    }
    case 'timeline': {
      const n = slide.events.length
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <ol style={{ listStyle: 'none', padding: 0, margin: `${z(52)}px 0 0`, position: 'relative', display: 'flex', flexDirection: 'column', gap: z(n > 5 ? 26 : 38) }}>
            <span style={{ position: 'absolute', left: 13, top: 12, bottom: 12, width: 2, background: `${ink}26` }} />
            {slide.events.map((e, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '28px 210px 1fr', gap: 26, alignItems: 'baseline', position: 'relative' }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: i === n - 1 ? accent : c.dark ? '#0A0A0A' : paper, border: `4px solid ${accent}`, boxSizing: 'border-box', alignSelf: 'center' }} />
                <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(30), color: accent, letterSpacing: '-0.01em' }}>{e.date}</span>
                <span style={{ fontSize: z(fit(e.text, 30, 90)), lineHeight: 1.4, color: ink }}>{e.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )
    }
    case 'quote':
      return (
        <div style={center}>
          <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: z(220), lineHeight: 0.6, color: accent, height: z(110) }}>“</div>
          <blockquote style={{ margin: 0, fontFamily: look.head, fontWeight: c.style === 'bold' ? 700 : look.headWeight, fontSize: z(fit(slide.quote, 62, 120)), lineHeight: 1.25, letterSpacing: look.headTrack, textWrap: 'balance' }}>{slide.quote}</blockquote>
          <div style={{ marginTop: z(48), display: 'flex', alignItems: 'center', gap: 20 }}>
            <Rule c={c} w={56} />
            <div>
              <div style={{ fontSize: z(30), fontWeight: 700 }}>{slide.who}</div>
              {slide.role && <div style={{ fontSize: z(24), color: muted, marginTop: 4 }}>{slide.role}</div>}
            </div>
          </div>
        </div>
      )
    case 'table': {
      const cols = slide.columns.length
      const cell = z(cols > 4 ? 24 : 28)
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <table style={{ marginTop: z(48), width: '100%', borderCollapse: 'collapse', fontSize: cell, lineHeight: 1.3 }}>
            <thead>
              <tr>
                {slide.columns.map((h, i) => (
                  <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, fontSize: z(20), letterSpacing: '0.08em', textTransform: 'uppercase', color: muted, padding: `0 ${i === cols - 1 ? 0 : 18}px 18px ${i === 0 ? 0 : 18}px`, borderBottom: `2px solid ${ink}33` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.rows.map((r, i) => (
                <tr key={i} style={{ background: slide.highlight === i ? mix(paper, accent, 0.14) : 'transparent' }}>
                  {r.map((v, j) => (
                    <td
                      key={j}
                      style={{
                        textAlign: j === 0 ? 'left' : 'right',
                        padding: `${z(22)}px ${j === cols - 1 ? (slide.highlight === i ? 14 : 0) : 18}px ${z(22)}px ${j === 0 ? (slide.highlight === i ? 14 : 0) : 18}px`,
                        borderBottom: `1.5px solid ${ink}17`,
                        fontWeight: j === 0 ? 600 : 400,
                        fontVariantNumeric: 'tabular-nums',
                        color: slide.highlight === i && j > 0 ? accent : ink,
                      }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'ranked': {
      const n = slide.items.length
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <ol style={{ listStyle: 'none', padding: 0, margin: `${z(48)}px 0 0`, display: 'flex', flexDirection: 'column' }}>
            {slide.items.map((it, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '96px 1fr auto', alignItems: 'center', gap: 20, padding: `${z(n > 5 ? 18 : 26)}px 0`, borderBottom: `1.5px solid ${ink}17` }}>
                <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(i === 0 ? 64 : 48), color: i === 0 ? accent : muted, lineHeight: 1, letterSpacing: look.numTrack }}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: z(34), fontWeight: 700, lineHeight: 1.2 }}>{it.name}</div>
                  {it.note && <div style={{ fontSize: z(fit(it.note, 24, 70)), color: muted, marginTop: 6, lineHeight: 1.35 }}>{it.note}</div>}
                </div>
                {it.value && <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(38), color: i === 0 ? accent : ink, fontVariantNumeric: 'tabular-nums' }}>{tidyMoney(it.value)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )
    }
    case 'diagram':
      return (
        <div style={top}>
          <Title size={fit(slide.title, 56, 70)} c={c}>
            {slide.title}
          </Title>
          <div style={{ flex: 1, minHeight: 0, marginTop: z(36) }}>
            {slide.shape === 'swot' ? <Swot items={slide.items} c={c} /> : <Diagram shape={slide.shape} items={slide.items} ink={ink} paper={paper} accent={accent} muted={muted} font={look.body} />}
          </div>
          {slide.note && <p style={{ fontSize: z(23), color: muted, lineHeight: 1.45, marginTop: 16 }}>{slide.note}</p>}
        </div>
      )
  }
}

/** SWOT as a 2×2 grid drawn here: AntV's version is too small to read at slide size. desc holds "; "-separated points. */
function Swot({ items, c }: { items: { label: string; desc?: string }[]; c: Ctx }) {
  const { ink, accent, paper, muted, look, k } = c
  const z = (n: number) => Math.round(n * k)
  const cells = items.slice(0, 4)
  const letters = ['S', 'W', 'O', 'T']
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: c.style === 'minimal' ? 0 : 14 }}>
      {cells.map((it, i) => {
        const points = (it.desc ?? '').split(/;|\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4)
        const hot = i === 0 || i === 2
        return (
          <div
            key={i}
            style={{
              background: c.style === 'minimal' ? 'transparent' : mix(paper, hot ? accent : ink, hot ? 0.1 : 0.06),
              border: c.style === 'minimal' ? `1.5px solid ${ink}22` : 'none',
              borderRadius: c.style === 'editorial' ? 14 : 0,
              padding: `${z(30)}px ${z(30)}px`,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(76), lineHeight: 1, color: hot ? accent : muted }}>{letters[i]}</span>
              <span style={{ fontSize: z(fit(it.label, 32, 18)), fontWeight: 700, letterSpacing: '0.02em', color: ink }}>{it.label}</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: `${z(22)}px 0 0`, display: 'flex', flexDirection: 'column', gap: z(12) }}>
              {points.map((p, j) => (
                <li key={j} style={{ fontSize: z(fit(p, 30, 50)), lineHeight: 1.35, color: ink, paddingLeft: 20, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, top: '0.55em', width: 8, height: 8, background: hot ? accent : muted, borderRadius: 99 }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/** Blends two hex colours; used for tinted panels that work on light and dark grounds. */
function mix(a: string, b: string, t: number) {
  const p = (h: string) => {
    const x = h.replace('#', '')
    const f = x.length === 3 ? x.split('').map((ch) => ch + ch).join('') : x.slice(0, 6)
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
  }
  const [ra, ga, ba] = p(a)
  const [rb, gb, bb] = p(b)
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${h(ra + (rb - ra) * t)}${h(ga + (gb - ga) * t)}${h(ba + (bb - ba) * t)}`
}

function Chart({ slide, c }: { slide: Extract<SlideSpec, { kind: 'chart' }>; c: Ctx }) {
  const { ink, accent, muted, look, k } = c
  const z = (n: number) => Math.round(n * k)
  const data = slide.data.filter((d) => Number.isFinite(d.value))
  if (!data.length) return null
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  const min = Math.min(...data.map((d) => d.value), 0)
  const hl = slide.highlight ?? (slide.chart === 'bar' ? data.findIndex((d) => d.value === max) : data.length - 1)
  const base = `${ink}2E`

  if (slide.chart === 'bar') {
    // Few bars get thick, so a 3-bar chart fills the slide instead of floating in it.
    const few = data.length <= 4
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: z(data.length > 6 ? 20 : few ? 56 : 30) }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '250px 1fr', alignItems: 'center', gap: 24 }}>
            <span style={{ fontSize: z(fit(d.label, few ? 40 : 34, 18)), fontWeight: i === hl ? 700 : 500, lineHeight: 1.2, color: i === hl ? ink : muted }}>{d.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ height: z(data.length > 6 ? 40 : few ? 104 : 56), width: `${Math.max(2, ((d.value - Math.min(0, min)) / (max - Math.min(0, min))) * 78)}%`, background: i === hl ? accent : base, borderRadius: c.style === 'minimal' ? 99 : c.style === 'editorial' ? 4 : 0 }} />
              <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(few ? 54 : 38), color: i === hl ? accent : ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{withUnit(d.value, slide.unit)}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const H = 620
  if (slide.chart === 'column') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: z(data.length > 7 ? 14 : 24), height: z(H) }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <span style={{ fontFamily: look.num, fontWeight: look.numWeight, fontSize: z(data.length > 6 ? 28 : 36), color: i === hl ? accent : ink, marginBottom: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{withUnit(d.value, slide.unit)}</span>
            <div style={{ width: '100%', height: `${Math.max(1.5, (Math.max(0, d.value) / max) * 76)}%`, background: i === hl ? accent : base, borderRadius: c.style === 'minimal' ? '14px 14px 0 0' : c.style === 'editorial' ? '4px 4px 0 0' : 0 }} />
            <span style={{ fontSize: z(data.length > 6 ? 23 : 28), color: i === hl ? ink : muted, marginTop: 14, textAlign: 'center', lineHeight: 1.2, fontWeight: i === hl ? 700 : 500 }}>{d.label}</span>
          </div>
        ))}
      </div>
    )
  }

  // line
  const W = 896
  const pad = { l: 10, r: 10, t: 70, b: 70 }
  const lo = Math.min(...data.map((d) => d.value))
  const hi = max
  const span = hi - lo || 1
  const x = (i: number) => pad.l + (data.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
  const label = (i: number) => i === 0 || i === data.length - 1 || i === hl
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible', maxHeight: z(H) }}>
      <polygon points={`${x(0)},${H - pad.b} ${pts} ${x(data.length - 1)},${H - pad.b}`} fill={accent} opacity={0.12} />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={base} strokeWidth={2} />
      <polyline points={pts} fill="none" stroke={accent} strokeWidth={c.style === 'bold' ? 9 : 6} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value)} r={i === hl ? 13 : 8} fill={i === hl ? accent : c.dark ? '#0A0A0A' : '#fff'} stroke={accent} strokeWidth={4} />
          {label(i) && (
            <text x={x(i)} y={y(d.value) - 30} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontFamily={look.num} fontWeight={look.numWeight} fontSize={40} fill={i === hl ? accent : ink}>
              {withUnit(d.value, slide.unit)}
            </text>
          )}
          <text x={x(i)} y={H - pad.b + 44} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontFamily={look.body} fontSize={data.length > 8 ? 24 : 28} fill={muted}>
            {data.length > 8 && !label(i) && i % 2 ? '' : d.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

const countNodes = (n: TreeNode): number => 1 + (n.children ?? []).reduce((a, ch) => a + countNodes(ch), 0)

function TreeRows({ node, depth, size, c, op }: { node: TreeNode; depth: number; size: number; c: Ctx; op?: string }) {
  const { ink, accent, muted, paper } = c
  const isRoot = depth === 0
  const isInput = node.op === 'input'
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 18,
          marginLeft: depth * 52,
          paddingLeft: depth ? 22 : 0,
          borderLeft: depth ? `3px solid ${isInput ? `${ink}1F` : accent}` : 'none',
          ...(isRoot ? { background: ink, color: paper, padding: '22px 28px', marginBottom: 6 } : {}),
        }}
      >
        {op !== undefined && <span style={{ fontWeight: 700, color: accent, width: 22, fontSize: size }}>{op}</span>}
        <span style={{ flex: 1, fontSize: isRoot ? size + 4 : size, fontWeight: isInput ? 400 : 700, lineHeight: 1.3, color: isRoot ? paper : isInput ? muted : ink }}>{node.label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: isRoot ? size + 6 : size, color: isRoot ? paper : isInput ? ink : accent, whiteSpace: 'nowrap' }}>{formatIndian(node.value ?? 0, node.unit)}</span>
      </div>
      {node.children?.map((ch, i) => <TreeRows key={i} node={ch} depth={depth + 1} size={size} c={c} op={i === 0 ? '' : node.op === 'sum' ? '+' : '×'} />)}
    </>
  )
}
