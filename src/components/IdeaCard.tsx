import clsx from 'clsx'
import { ArrowUpRight, Layers, Search } from 'lucide-react'
import { useState } from 'react'
import { PALETTES } from '../lib/brand'
import { act } from '../lib/chat'
import { FORMATS } from '../lib/scoring'
import { useStore } from '../lib/store'
import type { IdeaCard as Card } from '../lib/types'
import { CardSlide } from './deck'
import { Button, Modal, PaceTag, SourceList, SourceMarks, Tag } from './ui'

// Card fields can carry [n] markers from research; the card lists its own sources instead.
const clean = (t: string) => t.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')

const complexityTag = (c: Card) => `Complexity ${c.complexity.level}/5 · ~${c.complexity.hours}h`

export function IdeaCard({ card }: { card: Card }) {
  const openIdea = useStore((s) => s.openIdea)
  return (
    <article className="rounded-2xl px-5 py-[18px] ring-hair">
      <div className="flex gap-4">
        <button onClick={() => openIdea(card.id)} className="flex-1 text-left text-[16.5px] leading-[1.35] font-semibold tracking-[-0.01em] hover:underline hover:decoration-black/20 hover:underline-offset-4">
          {card.title}
        </button>
        <Engagement card={card} />
      </div>
      <Tags card={card} />
      {card.hook && <p className="mt-3 text-[16px]">“{card.hook}”</p>}
      <dl className="mt-2.5 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-[13.5px]">
        {card.trendRelevance && (
          <>
            <dt className="text-faint">Why now</dt>
            <dd className="text-ink-2">{clean(card.trendRelevance)}</dd>
          </>
        )}
        {card.audienceRelevance && (
          <>
            <dt className="text-faint">Audience</dt>
            <dd className="text-ink-2">{clean(card.audienceRelevance)}</dd>
          </>
        )}
        <dt className="text-faint">Why this format</dt>
        <dd className="text-ink-2">{clean(card.routingReason)}</dd>
      </dl>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <SourceMarks sources={card.sources} onClick={() => openIdea(card.id)} />
        <span className="flex-1" />
        <Button size="sm" onClick={() => openIdea(card.id)}>
          Details
        </Button>
        {card.status === 'built' ? (
          <Button size="sm" variant="dark" icon={<Layers className="size-3.5" />} onClick={() => useStore.getState().openStudio(card.id)}>
            Open slides
          </Button>
        ) : (
          <>
            <Button size="sm" icon={<Search className="size-3.5" />} onClick={() => act(`Research this further: “${card.title}” [idea ${card.id}]`)}>
              Research more
            </Button>
            <Button size="sm" variant="dark" onClick={() => act(`Build this: “${card.title}” [idea ${card.id}]`)}>
              Build this
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

function Engagement({ card }: { card: Card }) {
  if (!card.engagement.score) return null
  return (
    <div className="shrink-0 text-right" title="Evidence-based engagement potential, 0–100">
      <b className="tabular block text-[22px] leading-none font-semibold">{card.engagement.score}</b>
      <small className="text-[11.5px] text-faint">engagement</small>
    </div>
  )
}

function Tags({ card }: { card: Card }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      <Tag tone="dark">{FORMATS[card.format].short}</Tag>
      <PaceTag pace={card.pace} growth={card.growth} />
      <Tag>{complexityTag(card)}</Tag>
      {card.status === 'built' && <Tag tone="up">Built · {card.slides.length} slides</Tag>}
      {card.critique && (
        <Tag tone={card.critique.verdict === 'ship' ? 'up' : card.critique.verdict === 'fix' ? 'warn' : 'bad'}>
          Review {card.critique.score}/10
        </Tag>
      )}
    </div>
  )
}

/** Everything behind an idea: every marker, the evidence for the score, hooks, the brief and sources. */
export function IdeaModal() {
  const id = useStore((s) => s.openIdeaId)
  const card = useStore((s) => (id ? s.cards[id] : undefined))
  const openIdea = useStore((s) => s.openIdea)
  return (
    <Modal open={Boolean(card)} onClose={() => openIdea(null)} wide>
      {card && <IdeaDetail card={card} />}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-2.5 text-[13px] text-faint">{title}</h3>
      {children}
    </section>
  )
}

function IdeaDetail({ card }: { card: Card }) {
  const { openIdea, openStudio, deleteCard } = useStore()
  const [briefOpen, setBriefOpen] = useState(false)
  const go = (text: string) => {
    openIdea(null)
    act(text)
  }
  const comps = card.engagement.components
  const COMP: [string, string][] = [
    ['velocity', 'Momentum'],
    ['buzz', 'Discussion'],
    ['breadth', 'Coverage'],
    ['formatPrior', 'Format fit'],
    ['audienceFit', 'Audience fit'],
  ]
  return (
    <div className="max-h-[84vh] overflow-y-auto px-8 pt-7 pb-8 scroll-thin">
      <div className="pr-10 text-[13px] text-faint">
        {new Date(card.createdAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
        {card.origin === 'scan' ? "From today's scan" : card.origin === 'research' ? 'From research' : 'From chat'}
      </div>
      <div className="mt-1 flex gap-6 pr-10">
        <h2 className="flex-1 text-[23px] leading-tight font-medium tracking-[-0.015em]">{card.title}</h2>
        <Engagement card={card} />
      </div>
      <Tags card={card} />

      {card.status === 'built' && card.slides.length > 0 && (
        <button onClick={() => openStudio(card.id)} className="group mt-6 flex w-full gap-2.5 overflow-x-auto pb-1 scroll-thin">
          {card.slides.map((_, i) => (
            <div key={i} className="overflow-hidden rounded-md ring-hair">
              <CardSlide card={card} index={i} scale={0.12} />
            </div>
          ))}
        </button>
      )}

      <Section title="Suggested hook">
        <p className="text-[17px] leading-snug">“{card.hook}”</p>
        {card.hookVariants.length > 0 && (
          <ul className="mt-2.5 space-y-1 text-[14px] text-muted">
            {card.hookVariants.slice(0, 4).map((h) => (
              <li key={h}>“{h}”</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Markers">
        <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2.5 text-[14px]">
          <dt className="text-faint">Trend relevance</dt>
          <dd>{clean(card.trendRelevance) || '—'}</dd>
          <dt className="text-faint">Format</dt>
          <dd>
            {FORMATS[card.format].label}. {clean(card.routingReason)}
            {card.alternates.length > 0 && <span className="text-muted"> Also works as: {card.alternates.map((f) => FORMATS[f].short).join(', ')}.</span>}
          </dd>
          <dt className="text-faint">Audience relevance</dt>
          <dd>{clean(card.audienceRelevance) || '—'}</dd>
          <dt className="text-faint">Angle</dt>
          <dd>{clean(card.angle) || '—'}</dd>
          <dt className="text-faint">Execution</dt>
          <dd>
            {card.complexity.level}/5, about {card.complexity.hours} hours.
            {card.complexity.needs.length > 0 && <span className="text-muted"> Needs: {card.complexity.needs.join('; ')}.</span>}
          </dd>
          {card.palette && (
            <>
              <dt className="text-faint">Colours</dt>
              <dd>{PALETTES[card.palette].label}</dd>
            </>
          )}
        </dl>
      </Section>

      {card.engagement.score > 0 && (
        <Section title={`Engagement potential · ${card.engagement.score}/100`}>
          <div className="grid grid-cols-5 gap-3">
            {COMP.map(([k, label]) => (
              <div key={k}>
                <div className="h-1.5 overflow-hidden rounded-full bg-soft">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${Math.round((comps[k] ?? 0) * 100)}%` }} />
                </div>
                <div className="mt-1.5 text-[12px] text-muted">
                  {label} <span className="tabular text-faint">{comps[k] == null ? 'n/a' : Math.round(comps[k]! * 100)}</span>
                </div>
              </div>
            ))}
          </div>
          {card.engagement.evidence.length > 0 && (
            <ul className="mt-3.5 space-y-1 text-[13.5px] text-ink-2">
              {card.engagement.evidence.map((e) => (
                <li key={e} className="flex gap-2">
                  <span className="text-faint">·</span>
                  {e}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {card.critique && (
        <Section title={`Senior review · ${card.critique.score}/10`}>
          <ul className="space-y-1 text-[14px] text-ink-2">
            {card.critique.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-faint">·</span>
                {n}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {card.sources.length > 0 && (
        <Section title={`Sources · ${card.sources.length}`}>
          <SourceList sources={card.sources} numbered />
        </Section>
      )}

      {card.brief && (
        <Section title="Research brief">
          <div className={clsx('relative overflow-hidden text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2', !briefOpen && 'max-h-40')}>
            {card.brief.replace(/\[\d+(?:,\s*\d+)*\]/g, '')}
            {!briefOpen && <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white" />}
          </div>
          <button onClick={() => setBriefOpen(!briefOpen)} className="mt-1 text-[13px] text-muted hover:text-ink">
            {briefOpen ? 'Show less' : 'Show the full brief'}
          </button>
        </Section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Button variant="danger" size="sm" onClick={() => deleteCard(card.id)}>
          Delete
        </Button>
        <span className="flex-1" />
        <Button icon={<Search className="size-3.5" />} onClick={() => go(`Research this further: “${card.title}” [idea ${card.id}]`)}>
          Research more
        </Button>
        {card.status === 'built' ? (
          <Button variant="dark" icon={<ArrowUpRight className="size-3.5" />} onClick={() => openStudio(card.id)}>
            Open slides
          </Button>
        ) : (
          <Button variant="dark" onClick={() => go(`Build this: “${card.title}” [idea ${card.id}]`)}>
            Build this
          </Button>
        )}
      </div>
    </div>
  )
}
