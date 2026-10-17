import clsx from 'clsx'
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Images, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Scaled } from '../components/deck'
import { Button, Input, Menu, Swatch, Textarea } from '../components/ui'
import { slideSource } from '../lib/factcheck'
import { LOOKS } from '../slides/looks'
import { PALETTES, PALETTE_IDS, brandFor } from '../lib/brand'
import { reviseIdea } from '../lib/build'
import { canHavePicture, pictureFromFile, replacePicture } from '../lib/images'
import { FORMATS } from '../lib/scoring'
import { useStore } from '../lib/store'
import type { IdeaCard, PaletteId, SlideSpec, StyleId, TreeNode } from '../lib/types'
import { computeTree, formatIndian, rewriteHooks } from '../lib/writer'
import { SLIDE_H, SLIDE_W, Slide } from '../slides/Slide'
const exporter = () => import('../slides/export')

/** Full-screen editor for a built post: slides, caption, hooks, colours and export. */
export function StudioView() {
  const id = useStore((s) => s.studioCardId)
  const card = useStore((s) => (id ? s.cards[id] : undefined))
  const openStudio = useStore((s) => s.openStudio)
  useEffect(() => {
    if (!card) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea,input') && openStudio(null)
    document.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [card, openStudio])
  if (!card || card.status !== 'built' || !card.slides.length) return null
  return <Studio key={card.id} card={card} onClose={() => openStudio(null)} />
}

function Studio({ card, onClose }: { card: IdeaCard; onClose: () => void }) {
  const { brand, patchCard } = useStore()
  const [idx, setIdx] = useState(0)
  const [tab, setTab] = useState<'slide' | 'checks' | 'caption' | 'hooks'>('slide')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [change, setChange] = useState('')
  const [changed, setChanged] = useState<string | null>(null)
  const exportRefs = useRef<(HTMLDivElement | null)[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const b = brandFor(brand, card)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientHeight - 40) / SLIDE_H, (el.clientWidth - 120) / SLIDE_W)
      setScale(Math.max(0.22, Math.min(0.62, s)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea,input')) return
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(card.slides.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    document.addEventListener('keydown', keys)
    return () => document.removeEventListener('keydown', keys)
  }, [card.slides.length])

  const slides = card.slides
  const at = Math.min(idx, slides.length - 1)
  const current = slides[at]

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const setSlide = (i: number, next: SlideSpec) => {
    let updated = slides.map((s, j) => (j === i ? next : s))
    if (next.kind === 'tree') {
      const answer = formatIndian(next.tree.value ?? 0, next.tree.unit)
      updated = updated.map((s) => (s.kind === 'stat' && s.linked ? { ...s, value: answer } : s))
    }
    patchCard(card.id, { slides: updated })
  }

  const nodes = () => exportRefs.current.slice(0, slides.length).filter(Boolean) as HTMLElement[]

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-black/[0.06] px-5">
        <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-[9px] text-muted hover:bg-hover hover:text-ink">
          <X className="size-[18px]" />
        </button>
        <div className="min-w-0 flex-1 pl-1">
          <div className="truncate text-[15px] font-medium">{card.title}</div>
          <div className="text-[12.5px] text-faint">
            {FORMATS[card.format].short} · {slides.length} slides
          </div>
        </div>
        <Menu<StyleId>
          label="Style"
          align="right"
          value={card.style ?? 'editorial'}
          onChange={(style) => patchCard(card.id, { style })}
          options={(Object.keys(LOOKS) as StyleId[]).map((st) => ({ value: st, label: LOOKS[st].label, hint: LOOKS[st].blurb }))}
        />
        <Menu<PaletteId>
          label="Palette"
          align="right"
          value={card.palette ?? 'bgcc'}
          onChange={(palette) => patchCard(card.id, { palette })}
          options={PALETTE_IDS.map((p) => ({ value: p, label: PALETTES[p].label, swatch: <Swatch ink={PALETTES[p].palette.ink} accent={PALETTES[p].palette.accent} /> }))}
        />
        <Button icon={<Download className="size-3.5" />} loading={busy === 'one'} onClick={() => run('one', async () => (await exporter()).exportSinglePng(nodes()[at], card.title, at))}>
          This slide
        </Button>
        <Button icon={<Images className="size-3.5" />} loading={busy === 'zip'} onClick={() => run('zip', async () => (await exporter()).exportPngZip(nodes(), card.title))}>
          Instagram PNGs
        </Button>
        <Button variant="dark" icon={<FileText className="size-3.5" />} loading={busy === 'pdf'} onClick={() => run('pdf', async () => (await exporter()).exportPdf(nodes(), card.title))}>
          LinkedIn PDF
        </Button>
      </header>
      {error && <p className="bg-bad-soft px-6 py-2 text-[13.5px] text-bad">{error}</p>}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col bg-[#f7f7f8]">
          <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
            <button aria-label="Previous slide" disabled={at === 0} onClick={() => setIdx(at - 1)} className="raise absolute left-5 grid size-10 place-items-center rounded-full bg-white disabled:opacity-30">
              <ChevronLeft className="size-[18px]" />
            </button>
            <div className="overflow-hidden rounded-md shadow-[0_0_0_1px_#0000000f,0_24px_60px_-20px_#0000004d]">
              <Scaled scale={scale}>
                <Slide slide={current} index={at} total={slides.length} brand={b} style={card.style} source={slideSource(card, at)} />
              </Scaled>
            </div>
            <button aria-label="Next slide" disabled={at >= slides.length - 1} onClick={() => setIdx(at + 1)} className="raise absolute right-5 grid size-10 place-items-center rounded-full bg-white disabled:opacity-30">
              <ChevronRight className="size-[18px]" />
            </button>
          </div>
          <div className="flex justify-center gap-2.5 overflow-x-auto px-5 pt-1 pb-4 scroll-thin">
            {slides.map((s, i) => (
              <button key={i} onClick={() => setIdx(i)} className={clsx('relative shrink-0 overflow-hidden rounded-[4px] transition', i === at ? 'shadow-[0_0_0_2px_#111]' : 'opacity-60 hover:opacity-100')}>
                <Scaled scale={0.07}>
                  <Slide slide={s} index={i} total={slides.length} brand={b} style={card.style} source={slideSource(card, i)} />
                </Scaled>
                <SlideMark card={card} index={i} />
              </button>
            ))}
          </div>
        </section>

        <aside className="flex w-[360px] shrink-0 flex-col border-l border-black/[0.06]">
          <div className="flex gap-1 px-4 pt-4">
            {(['slide', 'checks', 'caption', 'hooks'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={clsx('rounded-[9px] px-3 py-1.5 text-[13.5px]', tab === t ? 'bg-soft font-medium text-ink' : 'text-muted hover:text-ink')}>
                {t === 'slide' ? `Slide ${at + 1}` : t === 'checks' ? 'Facts' : t === 'caption' ? 'Captions' : 'Hooks'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
            {tab === 'slide' && <SlideEditor key={`${card.id}-${at}`} slide={current} onChange={(s) => setSlide(at, s)} />}
            {tab === 'slide' && canHavePicture(current.kind) && (
              <PicturePanel
                key={`pic-${card.id}-${at}`}
                slide={current}
                busy={busy === 'picture'}
                onFind={(q) => run('picture', async () => patchCard(card.id, { slides: (await replacePicture(card, at, q)).slides }))}
                onUpload={(f) => run('picture', async () => setSlide(at, { ...current, picture: current.picture || 'uploaded', image: await pictureFromFile(f) }))}
                onRemove={() => setSlide(at, { ...current, picture: '', image: undefined })}
              />
            )}
            {tab === 'checks' && <ChecksPanel card={card} onGo={(i) => (setIdx(i), setTab('slide'))} />}
            {tab === 'caption' && <CaptionPanel card={card} />}
            {tab === 'hooks' && (
              <HooksPanel
                card={card}
                busy={busy === 'hooks'}
                onMore={() =>
                  run('hooks', async () => {
                    const hooks = await rewriteHooks(card, brand, '')
                    patchCard(card.id, { hookVariants: [...hooks, ...card.hookVariants].slice(0, 10) })
                  })
                }
              />
            )}
          </div>
          <form
            className="border-t border-black/[0.06] p-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!change.trim()) return
              void run('revise', async () => {
                const { summary } = await reviseIdea(card, change.trim())
                setChanged(summary)
                setChange('')
              })
            }}
          >
            <label className="mb-1.5 block text-[13px] text-faint">Ask for a change</label>
            <div className="flex gap-2">
              <Input value={change} onChange={(e) => setChange(e.target.value)} placeholder={`e.g. “make slide ${at + 1} punchier”`} />
              <Button type="submit" variant="dark" className="h-10" loading={busy === 'revise'} disabled={!change.trim()} icon={<Wand2 className="size-3.5" />} />
            </div>
            {changed && <p className="mt-2 text-[13px] text-good">{changed}</p>}
          </form>
        </aside>
      </div>

      <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
        {slides.map((s, i) => (
          <div key={i} ref={(el) => void (exportRefs.current[i] = el)}>
            <Slide slide={s} index={i} total={slides.length} brand={b} style={card.style} source={slideSource(card, i)} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- inspector panels ----------

/** A dot on each thumbnail: green when every figure is traced, amber when one needs checking. */
function SlideMark({ card, index }: { card: IdeaCard; index: number }) {
  const c = card.checks?.filter((x) => x.slide === index)
  if (!c?.length) return null
  const bad = c.some((x) => x.status === 'unsupported')
  return <span className={clsx('absolute top-1 right-1 size-2 rounded-full ring-2 ring-white', bad ? 'bg-[#f59e0b]' : 'bg-good')} />
}

const CHECK_LABEL = { sourced: 'In the sources', computed: 'Calculated', derived: 'Derived', assumption: 'Assumption', unsupported: 'Not found' } as const

function ChecksPanel({ card, onGo }: { card: IdeaCard; onGo: (i: number) => void }) {
  const checks = card.checks ?? []
  if (!checks.length) return <p className="text-[13.5px] text-muted">No figures checked yet. Posts built from now on are fact-checked automatically.</p>
  const bad = checks.filter((c) => c.status === 'unsupported').length
  return (
    <div>
      <p className="mb-4 text-[13.5px] leading-relaxed text-ink-2">
        Every number on the slides and in the captions was matched against the research brief.{' '}
        {bad ? <span className="text-warn">{bad} could not be traced: check them or ask for a change.</span> : <span className="text-good">All traced.</span>}
      </p>
      <ul className="space-y-2">
        {checks.map((c, i) => {
          const s = c.source ? card.sources[c.source - 1] : undefined
          return (
            <li key={i} className="rounded-[10px] px-3 py-2 ring-hair">
              <div className="flex items-baseline gap-2">
                <button onClick={() => c.slide >= 0 && onGo(c.slide)} className="text-[12px] text-faint hover:text-ink">
                  {c.slide < 0 ? 'Caption' : `Slide ${c.slide + 1}`}
                </button>
                <span className="flex-1 truncate text-[14px] font-medium">{c.claim}</span>
                <span className={clsx('inline-flex shrink-0 items-center gap-1 text-[12px]', c.status === 'unsupported' ? 'text-warn' : 'text-good')}>
                  {c.status === 'unsupported' ? <AlertCircle className="size-3" /> : <Check className="size-3" strokeWidth={2.6} />}
                  {CHECK_LABEL[c.status]}
                </span>
              </div>
              {(s || c.note) && (
                <div className="mt-1 text-[12.5px] leading-snug text-muted">
                  {s ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                      [{c.source}] {s.title}
                    </a>
                  ) : (
                    c.note
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The slide's picture: what it shows, where it came from, and finding, uploading or removing one. */
function PicturePanel({ slide, busy, onFind, onUpload, onRemove }: { slide: SlideSpec; busy: boolean; onFind: (q: string) => void; onUpload: (f: File) => void; onRemove: () => void }) {
  const [q, setQ] = useState(slide.picture || slide.image?.query || '')
  const file = useRef<HTMLInputElement>(null)
  const img = slide.image
  return (
    <div className="mt-6 space-y-2.5 border-t border-black/[0.06] pt-5">
      <SectionLabel>Picture</SectionLabel>
      {img ? (
        <figure className="space-y-1.5">
          <img src={img.src} alt="" className="aspect-[4/3] w-full rounded-[8px] object-cover" />
          {img.credit && (
            <figcaption className="text-[12px] text-faint">
              {img.page ? (
                <a href={img.page} target="_blank" rel="noreferrer" className="hover:text-ink">
                  {img.credit}
                </a>
              ) : (
                img.credit
              )}
            </figcaption>
          )}
        </figure>
      ) : (
        <p className="text-[12.5px] text-muted">No picture. Say what it should show and the desk searches the articles, Wikipedia and open collections.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) onFind(q)
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Blinkit delivery rider" />
        <Button type="submit" loading={busy} disabled={!q.trim()}>
          {img && q.trim() === img.query ? 'Another' : 'Find'}
        </Button>
      </form>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
          Upload
        </Button>
        {img && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
      </div>
    </div>
  )
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={clsx('text-[13px] text-faint', className)}>{children}</h3>
}

function Field({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] text-muted">{label}</span>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

const KIND_LABEL: Record<SlideSpec['kind'], string> = {
  cover: 'Cover',
  statement: 'Statement',
  bullets: 'Bullet list',
  stat: 'Big number',
  tree: 'Assumption tree',
  matrix: '2×2 matrix',
  steps: 'Steps',
  poll: 'Poll',
  closing: 'Closing',
  chart: 'Chart',
  kpis: 'Key numbers',
  compare: 'Comparison',
  timeline: 'Timeline',
  quote: 'Quote',
  table: 'Table',
  ranked: 'Ranking',
  diagram: 'Diagram',
}

// Multi-part rows edit as one line each, fields separated by " | ".
const toLines = (rows: (string | number | undefined)[][]) => rows.map((r) => r.map((x) => x ?? '').join(' | ')).join('\n')
const fromLines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((r) => r.some(Boolean))

function SlideEditor({ slide, onChange }: { slide: SlideSpec; onChange: (s: SlideSpec) => void }) {
  const set = (p: Partial<SlideSpec>) => onChange({ ...slide, ...p } as SlideSpec)
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <SectionLabel>{KIND_LABEL[slide.kind]}</SectionLabel>
        <span className="text-[12px] text-faint">Edits save automatically</span>
      </div>
      {slide.kind === 'cover' && (
        <>
          <Field label="Series label" value={slide.kicker} onChange={(v) => set({ kicker: v })} rows={1} />
          <Field label="Headline" value={slide.title} onChange={(v) => set({ title: v })} rows={3} />
          <Field label="Subtitle" value={slide.subtitle ?? ''} onChange={(v) => set({ subtitle: v })} />
        </>
      )}
      {slide.kind === 'statement' && (
        <>
          <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v })} />
          <Field label="Body" value={slide.body} onChange={(v) => set({ body: v })} rows={5} />
        </>
      )}
      {slide.kind === 'bullets' && (
        <>
          <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v })} />
          <Field label="Points (one per line)" value={slide.points.join('\n')} onChange={(v) => set({ points: v.split('\n') })} rows={7} />
        </>
      )}
      {slide.kind === 'stat' && (
        <>
          <Field label={slide.linked ? 'Value (computed from the tree)' : 'Value'} value={slide.value} onChange={(v) => set({ value: v, linked: false })} rows={1} />
          <Field label="Label" value={slide.label} onChange={(v) => set({ label: v })} />
          <Field label="Context" value={slide.context ?? ''} onChange={(v) => set({ context: v })} rows={3} />
        </>
      )}
      {slide.kind === 'tree' && (
        <>
          <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v })} />
          <TreeEditor
            tree={slide.tree}
            onChange={(tree) => {
              computeTree(tree)
              set({ tree })
            }}
          />
          <Field label="Footnote" value={slide.note ?? ''} onChange={(v) => set({ note: v })} />
        </>
      )}
      {slide.kind === 'matrix' && (
        <>
          <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="X axis" value={slide.xAxis} onChange={(v) => set({ xAxis: v })} rows={1} />
            <Field label="Y axis" value={slide.yAxis} onChange={(v) => set({ yAxis: v })} rows={1} />
          </div>
          {slide.quadrants.map((q, i) => (
            <Field
              key={i}
              label={`Quadrant ${i + 1}: ${q.title}`}
              value={q.body}
              onChange={(v) => set({ quadrants: slide.quadrants.map((x, j) => (j === i ? { ...x, body: v } : x)) })}
            />
          ))}
        </>
      )}
      {slide.kind === 'steps' && (
        <>
          <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v })} />
          {slide.steps.map((st, i) => (
            <Field
              key={i}
              label={`Step ${i + 1}: ${st.title}`}
              value={st.body}
              onChange={(v) => set({ steps: slide.steps.map((x, j) => (j === i ? { ...x, body: v } : x)) })}
            />
          ))}
        </>
      )}
      {slide.kind === 'poll' && (
        <>
          <Field label="Question" value={slide.question} onChange={(v) => set({ question: v })} />
          <Field label="Options (one per line)" value={slide.options.join('\n')} onChange={(v) => set({ options: v.split('\n') })} rows={4} />
        </>
      )}
      {slide.kind === 'closing' && (
        <>
          <Field label="Takeaway" value={slide.title} onChange={(v) => set({ title: v })} />
          <Field label="Call to action" value={slide.cta} onChange={(v) => set({ cta: v })} rows={3} />
        </>
      )}
      {'title' in slide && !['cover', 'statement', 'bullets', 'tree', 'matrix', 'steps', 'closing'].includes(slide.kind) && (
        <Field label="Action title" value={slide.title} onChange={(v) => set({ title: v } as Partial<SlideSpec>)} />
      )}
      {slide.kind === 'chart' && (
        <>
          <div className="flex gap-1.5">
            {(['bar', 'column', 'line'] as const).map((t) => (
              <button key={t} onClick={() => set({ chart: t })} className={clsx('rounded-lg px-2.5 py-1 text-[13px]', slide.chart === t ? 'bg-ink text-white' : 'ring-hair')}>
                {t === 'bar' ? 'Bars' : t === 'column' ? 'Columns' : 'Line'}
              </button>
            ))}
          </div>
          <Field
            label="Data (label | value, one per line)"
            rows={6}
            value={toLines(slide.data.map((d) => [d.label, d.value]))}
            onChange={(v) => set({ data: fromLines(v).map(([label, value]) => ({ label, value: parseFloat((value ?? '').replace(/[^0-9.-]/g, '')) || 0 })) })}
          />
          <Field label="Unit (₹ cr, %, lakh…)" rows={1} value={slide.unit ?? ''} onChange={(v) => set({ unit: v || undefined })} />
          <Field label="Source note" value={slide.note ?? ''} onChange={(v) => set({ note: v || undefined })} />
        </>
      )}
      {slide.kind === 'kpis' && (
        <Field label="Numbers (value | label, one per line)" rows={5} value={toLines(slide.items.map((i) => [i.value, i.label]))} onChange={(v) => set({ items: fromLines(v).map(([value, label]) => ({ value, label: label ?? '' })) })} />
      )}
      {slide.kind === 'compare' && (
        <>
          {(['left', 'right'] as const).map((k) => (
            <div key={k} className="space-y-2 rounded-xl bg-soft p-3">
              <Field label={k === 'left' ? 'Left: name' : 'Right: name'} rows={1} value={slide[k].name} onChange={(v) => set({ [k]: { ...slide[k], name: v } })} />
              <Field label="Big number | its label" rows={1} value={toLines([[slide[k].stat, slide[k].statLabel]])} onChange={(v) => { const [st, sl] = fromLines(v)[0] ?? []; set({ [k]: { ...slide[k], stat: st || undefined, statLabel: sl || undefined } }) }} />
              <Field label="Points (one per line)" rows={3} value={slide[k].points.join('\n')} onChange={(v) => set({ [k]: { ...slide[k], points: v.split('\n') } })} />
            </div>
          ))}
          <Field label="Verdict" value={slide.verdict ?? ''} onChange={(v) => set({ verdict: v || undefined })} />
        </>
      )}
      {slide.kind === 'timeline' && (
        <Field label="Events (date | what happened)" rows={7} value={toLines(slide.events.map((e) => [e.date, e.text]))} onChange={(v) => set({ events: fromLines(v).map(([date, text]) => ({ date, text: text ?? '' })) })} />
      )}
      {slide.kind === 'quote' && (
        <>
          <Field label="Quote" rows={4} value={slide.quote} onChange={(v) => set({ quote: v })} />
          <Field label="Who" rows={1} value={slide.who} onChange={(v) => set({ who: v })} />
          <Field label="Role" rows={1} value={slide.role ?? ''} onChange={(v) => set({ role: v || undefined })} />
        </>
      )}
      {slide.kind === 'table' && (
        <>
          <Field label="Columns (a | b | c)" rows={1} value={slide.columns.join(' | ')} onChange={(v) => set({ columns: v.split('|').map((x) => x.trim()) })} />
          <Field label="Rows (one per line, cells separated by |)" rows={6} value={toLines(slide.rows)} onChange={(v) => set({ rows: fromLines(v) })} />
        </>
      )}
      {slide.kind === 'ranked' && (
        <Field label="Items (name | value | note)" rows={7} value={toLines(slide.items.map((i) => [i.name, i.value, i.note]))} onChange={(v) => set({ items: fromLines(v).map(([name, value, note]) => ({ name, value: value || undefined, note: note || undefined })) })} />
      )}
      {slide.kind === 'diagram' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(['pyramid', 'funnel', 'cycle', 'roadmap', 'swot'] as const).map((t) => (
              <button key={t} onClick={() => set({ shape: t })} className={clsx('rounded-lg px-2.5 py-1 text-[13px] capitalize', slide.shape === t ? 'bg-ink text-white' : 'ring-hair')}>
                {t === 'swot' ? 'SWOT' : t}
              </button>
            ))}
          </div>
          <Field label="Items (label | short description)" rows={6} value={toLines(slide.items.map((i) => [i.label, i.desc]))} onChange={(v) => set({ items: fromLines(v).map(([label, desc]) => ({ label, desc: desc || undefined })) })} />
        </>
      )}
    </div>
  )
}

/** Edit leaf assumptions; parents recompute so the answer stays consistent. */
function TreeEditor({ tree, onChange }: { tree: TreeNode; onChange: (t: TreeNode) => void }) {
  const clone = (): TreeNode => JSON.parse(JSON.stringify(tree))
  const leaves: { path: number[]; node: TreeNode }[] = []
  const walk = (n: TreeNode, path: number[]) => {
    if (n.op === 'input') leaves.push({ path, node: n })
    n.children?.forEach((c, i) => walk(c, [...path, i]))
  }
  walk(tree, [])
  const at = (root: TreeNode, path: number[]) => path.reduce((n, i) => n.children![i], root)

  return (
    <div className="rounded-xl bg-soft p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12.5px] text-muted">Assumptions</span>
        <span className="tabular text-[12px] font-semibold">= {formatIndian(tree.value ?? 0, tree.unit)}</span>
      </div>
      <div className="space-y-2">
        {leaves.map(({ path, node }) => (
          <label key={path.join('.')} className="grid grid-cols-[1fr_96px] items-center gap-2">
            <span className="text-[12px] leading-snug text-ink-2">
              {node.label}
              {node.unit && <span className="text-faint"> ({node.unit === '%' ? 'decimal share' : node.unit})</span>}
            </span>
            <input
              type="number"
              step="any"
              value={node.value ?? 0}
              onChange={(e) => {
                const next = clone()
                at(next, path).value = parseFloat(e.target.value) || 0
                onChange(next)
              }}
              className="tabular h-8 rounded-lg bg-white px-2 text-right text-[13px] ring-hair-strong focus:shadow-[0_0_0_2px_#111] focus:outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function CopyBtn({ k, text, copied, onCopy }: { k: string; text: string; copied: string | null; onCopy: (k: string, t: string) => void }) {
  return (
    <Button size="sm" variant="ghost" icon={copied === k ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => onCopy(k, text)}>
      {copied === k ? 'Copied' : 'Copy'}
    </Button>
  )
}

function CaptionPanel({ card }: { card: IdeaCard }) {
  const { patchCard } = useStore()
  const [copied, setCopied] = useState<string | null>(null)
  const [channel, setChannel] = useState<'linkedin' | 'instagram'>('linkedin')
  const text = channel === 'linkedin' ? card.caption : (card.captionInstagram ?? '')
  const setText = (v: string) => patchCard(card.id, channel === 'linkedin' ? { caption: v } : { captionInstagram: v })
  const copy = async (k: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(k)
    setTimeout(() => setCopied(null), 1400)
  }
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-1">
            {(['linkedin', 'instagram'] as const).map((ch) => (
              <button key={ch} onClick={() => setChannel(ch)} className={clsx('rounded-lg px-2.5 py-1 text-[13px]', channel === ch ? 'bg-ink text-white' : 'text-muted ring-hair')}>
                {ch === 'linkedin' ? 'LinkedIn' : 'Instagram'}
              </button>
            ))}
          </div>
          <CopyBtn copied={copied} onCopy={copy} k="caption" text={`${text}\n\n${card.hashtags.join(' ')}`} />
        </div>
        <Textarea rows={13} value={text} onChange={(e) => setText(e.target.value)} placeholder={channel === 'instagram' ? 'Ask for a change: “write an Instagram caption”' : ''} />
        <div className="mt-1 text-right text-[12px] text-faint tabular">{text.split(/\s+/).filter(Boolean).length} words</div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <SectionLabel>Hashtags</SectionLabel>
          <CopyBtn copied={copied} onCopy={copy} k="tags" text={card.hashtags.join(' ')} />
        </div>
        <Textarea
          rows={2}
          value={card.hashtags.join(' ')}
          onChange={(e) => patchCard(card.id, { hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <SectionLabel>Alt text</SectionLabel>
          <CopyBtn copied={copied} onCopy={copy} k="alt" text={card.altText} />
        </div>
        <Textarea rows={3} value={card.altText} onChange={(e) => patchCard(card.id, { altText: e.target.value })} />
        <div className={clsx('mt-1 text-right text-[12px] tabular', card.altText.length > 125 ? 'text-warn' : 'text-faint')}>
          {card.altText.length}/125
        </div>
      </div>
    </div>
  )
}

function HooksPanel({ card, busy, onMore }: { card: IdeaCard; busy: boolean; onMore: () => void }) {
  const { patchCard } = useStore()
  const options = [card.critique?.betterHook, ...card.hookVariants].filter((h): h is string => !!h && h !== card.hook)
  const applyHook = (h: string) => {
    const slides = card.slides.map((s, i) => (i === 0 && s.kind === 'cover' ? { ...s, title: h } : s))
    patchCard(card.id, { hook: h, hookVariants: [card.hook, ...card.hookVariants.filter((x) => x !== h)], slides })
  }
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-1.5">Current hook</SectionLabel>
        <p className="border-l-2 border-ink pl-3 text-[15.5px] leading-snug">{card.hook}</p>
      </div>
      <div>
        <SectionLabel className="mb-1.5">Alternatives</SectionLabel>
        <ul className="space-y-1.5">
          {options.map((h) => (
            <li key={h}>
              <button
                onClick={() => applyHook(h)}
                className="w-full rounded-[10px] px-3 py-2 text-left text-[13.5px] leading-snug text-ink-2 ring-hair hover:text-ink hover:ring-black/20"
              >
                {h === card.critique?.betterHook && <span className="mb-0.5 block text-[12px] font-medium text-good">Reviewer’s pick</span>}
                {h}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12.5px] text-faint">Choosing a hook also updates the cover slide.</p>
      </div>
      <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={busy} onClick={onMore}>
        Write five more
      </Button>
    </div>
  )
}
