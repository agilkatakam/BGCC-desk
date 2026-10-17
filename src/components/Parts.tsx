import clsx from 'clsx'
import { AlertCircle, Check, ChevronDown, Download, FileText, Layers, Loader2, Minus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PALETTES, PALETTE_IDS, brandFor, paletteId, styleId } from '../lib/brand'
import { FORMATS } from '../lib/scoring'
import { LOOKS } from '../slides/looks'
import { send, useRunning } from '../lib/chat'
import { useStore } from '../lib/store'
import type { ChatPart, DeepRun, IdeaCard as Card, PaletteId, ProgressStep, SlideSpec, SourceRef, StyleId } from '../lib/types'
import { Slide } from '../slides/Slide'
import { CardSlide, Scaled } from './deck'
import { IdeaCard } from './IdeaCard'
import { slideSource } from '../lib/factcheck'
import { Button, Swatch } from './ui'
const exporter = () => import('../slides/export')

// ---------- markdown with citation pills ----------

const linkCites = (text: string) =>
  text.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_, g: string) =>
    g
      .split(',')
      .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
      .join(''),
  )

export function Prose({ text, sources }: { text: string; sources: SourceRef[] }) {
  const md = useMemo(() => linkCites(text), [text])
  return (
    <div className="prose-desk">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/)
            if (m) {
              const s = sources[Number(m[1]) - 1]
              return s ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="cite" title={`${s.title}`}>
                  {m[1]}
                </a>
              ) : (
                <span className="cite">{m[1]}</span>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {md}
      </Markdown>
    </div>
  )
}

// ---------- progress ----------

function StepIcon({ status }: { status: ProgressStep['status'] }) {
  if (status === 'running') return <Loader2 className="size-[15px] animate-spin text-muted" />
  if (status === 'done') return <Check className="size-[15px] text-good" strokeWidth={2.4} />
  if (status === 'error') return <AlertCircle className="size-[15px] text-warn" />
  if (status === 'skipped') return <Minus className="size-[15px] text-faint" />
  return <span className="mx-[4px] block size-[7px] rounded-full bg-[#d4d5d8]" />
}

function Steps({ steps }: { steps: ProgressStep[] }) {
  return (
    <ul className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2.5 text-[14px]">
          <span className="mt-[3px] grid w-[15px] place-items-center">
            <StepIcon status={s.status} />
          </span>
          <span className={clsx('min-w-0 flex-1', s.status === 'pending' ? 'text-faint' : 'text-ink-2', s.status === 'running' && 'shimmer')}>{s.label}</span>
          {s.detail && <span className="max-w-[45%] shrink-0 truncate text-right text-[13px] text-faint">{s.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

/** A titled list of steps that folds into one line when finished. */
function StepBlock({ title, steps, done, summary }: { title: string; steps: ProgressStep[]; done?: boolean; summary?: string }) {
  const [open, setOpen] = useState(false)
  const errored = steps.some((s) => s.status === 'error')
  if (done && !open)
    return (
      <button onClick={() => setOpen(true)} className="mb-4 flex items-center gap-2 text-[14px] text-muted hover:text-ink">
        {errored && !steps.some((s) => s.status === 'done') ? <AlertCircle className="size-[15px] text-warn" /> : <Check className="size-[15px] text-good" strokeWidth={2.4} />}
        {summary ?? title}
        <ChevronDown className="size-3.5" />
      </button>
    )
  return (
    <div className="mb-4 rounded-[14px] px-4 py-3.5 ring-hair">
      <button onClick={() => done && setOpen(false)} className="mb-3 flex w-full items-center gap-2 text-left text-[14px] font-medium">
        {title}
        {done && <ChevronDown className="size-3.5 rotate-180 text-muted" />}
      </button>
      <Steps steps={steps} />
    </div>
  )
}

const progressSummary = (title: string, steps: ProgressStep[]) => {
  const detail = steps.find((s) => s.id === 'collect')?.detail
  return detail ? `${title.replace(/^Finding/, 'Found').replace(/^Building/, 'Built')} · ${detail}` : title.replace(/^Finding/, 'Found').replace(/^Building/, 'Built')
}

// ---------- research ----------

const RUN_LABEL: Record<DeepRun['status'], string> = {
  planning: 'Planning the searches',
  searching: 'Searching',
  reflecting: 'Looking for gaps',
  writing: 'Writing the brief',
  ideas: 'Turning it into post ideas',
  done: 'Done',
  error: 'Stopped',
}

function Research({ run, sources }: { run: DeepRun; sources: SourceRef[] }) {
  const all = useStore((s) => s.cards)
  const cards = run.ideaIds.map((id) => all[id]).filter(Boolean) as Card[]
  const [showSources, setShowSources] = useState(false)
  const finished = run.status === 'done' || run.status === 'error'
  const used = useMemo(() => [...new Set(run.steps.flatMap((s) => s.sourceIds ?? []))].sort((a, b) => a - b), [run.steps])
  const secs = run.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) : 0
  const steps: ProgressStep[] = [
    { id: 'plan', label: 'Planning the searches', status: run.steps.length ? 'done' : run.status === 'error' ? 'error' : 'running' },
    ...run.steps,
    ...(['writing', 'ideas', 'done'].includes(run.status) || (run.status === 'error' && run.report)
      ? [{ id: 'write', label: 'Writing the brief', status: (run.report && run.status !== 'writing' ? 'done' : 'running') as ProgressStep['status'] }]
      : []),
  ]
  return (
    <div className="mb-2">
      <StepBlock
        title={finished ? `Researched “${run.question}”` : `Researching · ${RUN_LABEL[run.status]}`}
        steps={steps}
        done={finished}
        summary={`Researched ${run.steps.length} angles · ${used.length} sources${secs ? ` · ${secs}s` : ''}`}
      />
      {run.error && <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13.5px] text-warn">{run.error}</p>}
      {run.report && <Prose text={run.report} sources={sources} />}
      {run.figures.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {run.figures.map((f, i) => (
            <div key={i} className="rounded-[14px] bg-soft px-4 py-3.5">
              <div className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">{f.value}</div>
              <div className="mt-1 text-[12.5px] leading-snug text-muted">
                {f.label}
                {f.source && sources[f.source - 1] && (
                  <a href={sources[f.source - 1].url} target="_blank" rel="noreferrer" className="cite ml-1">
                    {f.source}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {used.length > 0 && finished && (
        <div className="mt-5">
          <button onClick={() => setShowSources(!showSources)} className="flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
            {used.length} sources
            <ChevronDown className={clsx('size-3.5 transition-transform', showSources && 'rotate-180')} />
          </button>
          {showSources && (
            <ol className="mt-3 space-y-1.5">
              {used.map((n) => (
                <li key={n} className="flex gap-2.5 text-[13.5px] leading-snug">
                  <span className="tabular w-5 shrink-0 text-right text-faint">{n}</span>
                  <a href={sources[n - 1]?.url} target="_blank" rel="noreferrer" className="hover:underline">
                    <span className="text-ink-2">{sources[n - 1]?.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {run.status === 'ideas' && (
        <p className="mt-6 flex items-center gap-2 text-[14px] text-muted">
          <Loader2 className="size-[15px] animate-spin" />
          <span className="shimmer">Turning it into post ideas and measuring momentum</span>
        </p>
      )}
      {cards.length > 0 && (
        <div className="mt-7">
          <h3 className="mb-3 text-[13px] text-faint">Post ideas from this research</h3>
          <div className="space-y-3">
            {cards.map((c) => (
              <IdeaCard key={c.id} card={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- deck ----------

function Deck({ cardId }: { cardId: string }) {
  const card = useStore((s) => s.cards[cardId])
  const { brand, openStudio } = useStore()
  const [busy, setBusy] = useState(false)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  if (!card || card.status !== 'built') return null
  const b = brandFor(brand, card)
  return (
    <div className="mb-5 rounded-2xl px-5 py-4 ring-hair">
      <div className="flex items-baseline gap-3">
        <h3 className="flex-1 text-[15.5px] leading-snug font-semibold">{card.title}</h3>
        <span className="shrink-0 text-[13px] text-faint">
          {card.slides.length} slides · {PALETTES[card.palette ?? 'bgcc'].label}
        </span>
      </div>
      <button onClick={() => openStudio(card.id)} className="mt-3.5 flex w-full gap-2 overflow-x-auto pb-1 scroll-thin" title="Open the editor">
        {card.slides.map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[6px] ring-hair">
            <CardSlide card={card} index={i} scale={0.118} />
          </div>
        ))}
      </button>
      <CheckSummary card={card} />
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {card.critique && (
          <span className="text-[13px] text-muted">
            Senior review: {card.critique.verdict === 'ship' ? 'ready to ship' : card.critique.verdict === 'fix' ? 'needs a few fixes' : 'rethink it'} · {card.critique.score}/10
          </span>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          loading={busy}
          icon={<Download className="size-3.5" />}
          onClick={async () => {
            setBusy(true)
            try {
              await (await exporter()).exportPdf(refs.current.filter(Boolean) as HTMLElement[], card.title)
            } finally {
              setBusy(false)
            }
          }}
        >
          PDF
        </Button>
        <Button size="sm" variant="dark" icon={<Layers className="size-3.5" />} onClick={() => openStudio(card.id)}>
          Edit slides & caption
        </Button>
      </div>
      <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
        {busy &&
          card.slides.map((s, i) => (
            <div key={i} ref={(el) => void (refs.current[i] = el)}>
              <Slide slide={s} index={i} total={card.slides.length} brand={b} style={card.style} source={slideSource(card, i)} />
            </div>
          ))}
      </div>
    </div>
  )
}

/** "14 figures checked against sources · 1 needs a look" */
export function CheckSummary({ card }: { card: Card }) {
  const c = card.checks
  if (!c?.length && !card.designNotes?.length) return null
  const bad = c?.filter((x) => x.status === 'unsupported').length ?? 0
  const ok = (c?.length ?? 0) - bad
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
      {c && c.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-good">
          <Check className="size-3.5" strokeWidth={2.4} />
          {ok} of {c.length} figures traced to the research
        </span>
      )}
      {bad > 0 && (
        <span className="inline-flex items-center gap-1.5 text-warn">
          <AlertCircle className="size-3.5" />
          {bad} to verify by hand
        </span>
      )}
      {card.designNotes?.map((n) => (
        <span key={n} className="inline-flex items-center gap-1.5 text-warn">
          <AlertCircle className="size-3.5" />
          {n}
        </span>
      ))}
    </div>
  )
}

// ---------- ask ----------

function Ask({ part, threadId, live }: { part: ChatPart; threadId: string; live: boolean }) {
  const ask = part.ask!
  const busy = useRunning((s) => Boolean(s.busy[threadId]))
  const answered = ask.answer
  const pick = (o: string) => !answered && !busy && live && void send(threadId, o.replace(/\s*\(recommended\)$/i, ''))
  return (
    <div className="mb-4">
      <p className="mb-3 text-[15px]">{ask.question}</p>
      {(ask.kind as string) !== 'choice' ? (
        <LookPicker cardId={ask.cardId} answered={answered} disabled={Boolean(answered) || !live || busy} onPick={(v) => void send(threadId, v)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {ask.options.map((o) => {
            const chosen = answered === o.replace(/\s*\(recommended\)$/i, '')
            return (
              <button
                key={o}
                disabled={Boolean(answered) || !live}
                onClick={() => pick(o)}
                className={clsx('rounded-[10px] px-3.5 py-2 text-[14px] font-medium', chosen ? 'bg-ink text-white' : 'raise', answered && !chosen && 'opacity-40')}
              >
                {o}
              </button>
            )
          })}
        </div>
      )}
      {answered && !ask.options.some((o) => o.replace(/\s*\(recommended\)$/i, '') === answered) && ask.kind === 'choice' && <p className="mt-2 text-[13px] text-faint">You said: {answered}</p>}
    </div>
  )
}

/** The idea's cover in each slide style, with colour schemes; one tap picks the look. */
function LookPicker({ cardId, answered, disabled, onPick }: { cardId?: string; answered?: string; disabled: boolean; onPick: (v: string) => void }) {
  const card = useStore((s) => (cardId ? s.cards[cardId] : undefined))
  const { brand, prefs } = useStore()
  const [style, setStyle] = useState<StyleId>(styleId(answered) ?? (prefs.style !== 'ask' ? prefs.style : 'editorial'))
  const [pal, setPal] = useState<PaletteId>(paletteId(answered) ?? (prefs.palette !== 'ask' ? prefs.palette : 'bgcc'))
  const cover: SlideSpec = { kind: 'cover', kicker: card ? FORMATS[card.format].short : 'Case in Point', title: card?.hook || card?.title || 'Can 10-minute delivery ever make money?' }
  const b = { ...brand, palette: PALETTES[pal].palette }
  return (
    <div className={clsx(answered && 'pointer-events-none')}>
      <div className="flex flex-wrap gap-3">
        {(Object.keys(LOOKS) as StyleId[]).map((id) => (
          <button key={id} disabled={disabled} onClick={() => setStyle(id)} className={clsx('rounded-[12px] p-1.5 text-left transition-shadow', style === id ? 'shadow-[0_0_0_2px_#111]' : 'raise', answered && style !== id && 'opacity-40')}>
            <div className="overflow-hidden rounded-[7px]">
              <Scaled scale={0.19}>
                <Slide slide={cover} index={0} total={8} brand={b} style={id} />
              </Scaled>
            </div>
            <div className="px-1 pt-2 pb-0.5 text-[13.5px] font-medium">{LOOKS[id].label}</div>
            <div className="max-w-[190px] px-1 pb-1 text-[12px] leading-snug text-faint">{LOOKS[id].blurb}</div>
          </button>
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {PALETTE_IDS.map((id) => (
          <button key={id} disabled={disabled} onClick={() => setPal(id)} className={clsx('inline-flex items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-[13px]', pal === id ? 'shadow-[0_0_0_2px_#111]' : 'raise', answered && pal !== id && 'opacity-40')}>
            <Swatch ink={PALETTES[id].palette.ink} accent={PALETTES[id].palette.accent} />
            {PALETTES[id].label}
          </button>
        ))}
        <span className="flex-1" />
        {!answered && (
          <Button variant="dark" size="sm" disabled={disabled} onClick={() => onPick(`${LOOKS[style].label} · ${PALETTES[pal].label}`)}>
            Use this look
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------- one part ----------

export function Part({ part, threadId, sources, live }: { part: ChatPart; threadId: string; sources: SourceRef[]; live: boolean }) {
  const cards = useStore((s) => s.cards)
  switch (part.type) {
    case 'text':
      return part.text ? (
        <div className="mb-4">
          <Prose text={part.text} sources={sources} />
        </div>
      ) : null
    case 'tool': {
      const t = part.tool!
      return (
        <div className="mb-4 flex items-start gap-2.5 text-[14px] text-muted">
          <span className="mt-[3px]">
            <StepIcon status={t.status === 'running' ? 'running' : t.status === 'done' ? 'done' : 'error'} />
          </span>
          <span className={clsx(t.status === 'running' && 'shimmer')}>
            {t.label}
            {t.detail && <span className="text-faint"> · {t.detail}</span>}
          </span>
        </div>
      )
    }
    case 'progress': {
      const p = part.progress!
      return <StepBlock title={p.title} steps={p.steps} done={p.done} summary={progressSummary(p.title, p.steps)} />
    }
    case 'research':
      return part.research ? <Research run={part.research} sources={sources} /> : null
    case 'ideas':
      return (
        <div className="mb-5 space-y-3">
          {(part.cardIds ?? []).map((id) => (cards[id] ? <IdeaCard key={id} card={cards[id]} /> : null))}
        </div>
      )
    case 'deck':
      return part.cardId ? <Deck cardId={part.cardId} /> : null
    case 'ask':
      return <Ask part={part} threadId={threadId} live={live} />
    case 'files':
      return (
        <div className="mb-2 flex flex-wrap justify-end gap-2">
          {(part.files ?? []).map((f, i) =>
            f.thumb ? (
              <img key={i} src={f.thumb} alt={f.name} className="h-24 rounded-[12px] object-cover ring-hair" />
            ) : (
              <span key={i} className="flex items-center gap-2 rounded-[12px] bg-soft px-3 py-2 text-[13px]">
                <FileText className="size-4 text-muted" />
                {f.name}
              </span>
            ),
          )}
        </div>
      )
  }
  return null
}
