import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Thumb } from '../components/deck'
import { FORMATS, FORMAT_IDS } from '../lib/scoring'
import { useStore } from '../lib/store'
import type { FormatId, IdeaCard } from '../lib/types'

type Filter = 'all' | 'built' | FormatId

const dayKey = (iso: string) => new Date(iso).toDateString()

function groupLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
}

export function IdeasView() {
  const cards = useStore((s) => s.cards)
  const runs = useStore((s) => s.runs)
  const openIdea = useStore((s) => s.openIdea)
  const [filter, setFilter] = useState<Filter>('all')

  const list = useMemo(
    () =>
      Object.values(cards)
        .filter((c) => (filter === 'all' ? true : filter === 'built' ? c.status === 'built' : c.format === filter))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [cards, filter],
  )
  const groups = useMemo(() => {
    const out: { key: string; label: string; cards: IdeaCard[] }[] = []
    for (const c of list) {
      const k = dayKey(c.createdAt)
      const g = out.find((x) => x.key === k)
      if (g) g.cards.push(c)
      else out.push({ key: k, label: groupLabel(c.createdAt), cards: [c] })
    }
    return out
  }, [list])
  const scanTime = (k: string) => {
    const r = runs.find((x) => dayKey(x.startedAt) === k)
    return r ? ` · from the ${new Date(r.startedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} scan` : ''
  }
  const present = new Set(Object.values(cards).map((c) => c.format))

  return (
    <div className="mx-auto max-w-[920px] px-6 pt-[120px] pb-[120px]">
      <h1 className="text-[28px] font-normal tracking-[-0.02em]">Previous ideas</h1>
      <p className="mt-1 text-[14.5px] text-muted">Every idea the desk has suggested or built. Open one to keep working on it.</p>
      <div className="mt-6 mb-2 flex flex-wrap gap-1.5">
        {(['all', 'built', ...FORMAT_IDS.filter((f) => present.has(f))] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx('rounded-[9px] px-3 py-1.5 text-[13.5px]', filter === f ? 'bg-ink text-white' : 'text-muted ring-hair hover:text-ink')}
          >
            {f === 'all' ? 'All' : f === 'built' ? 'Built' : FORMATS[f].short}
          </button>
        ))}
      </div>
      {!list.length && <p className="mt-16 text-center text-[14.5px] text-faint">{filter === 'all' ? 'No ideas yet. Ask the desk for “3 ideas for today”.' : 'Nothing here yet.'}</p>}
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mt-9 mb-[18px] text-[13px] text-faint">
            {g.label}
            {scanTime(g.key)}
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {g.cards.map((c, i) => (
              <button key={c.id} onClick={() => openIdea(c.id)} className="group flex items-center gap-[18px] text-left">
                <Thumb card={c} tint={i} />
                <div className="min-w-0">
                  <h3 className="line-clamp-3 text-[15.5px] leading-[1.3] font-medium tracking-[-0.01em]">{c.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-snug text-muted">
                    {FORMATS[c.format].short}
                    {c.pace && c.pace !== 'Unmeasured' && (
                      <>
                        {' · '}
                        <span className={clsx((c.pace === 'Exploding' || c.pace === 'Rising') && 'text-good')}>
                          {(c.pace === 'Exploding' || c.pace === 'Rising') && '▲ '}
                          {c.pace}
                        </span>
                      </>
                    )}
                    {c.engagement.score > 0 && ` · ${c.engagement.score}`}
                    {c.status === 'built' && ' · Built'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
