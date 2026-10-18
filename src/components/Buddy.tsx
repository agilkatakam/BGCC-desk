import clsx from 'clsx'
import { Mic, MicOff, PhoneOff, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { LiveDesk } from '../lib/live'
import { getState, useStore } from '../lib/store'
import type { ChatMessage, ChatPart, ChatThread } from '../lib/types'
import { uid } from '../lib/writer'
import type { ClayMood } from './Clay3D'

// three.js is large; Clay loads after the app does, holding his space until then.
const Clay3D = lazy(() => import('./Clay3D').then((m) => ({ default: m.Clay3D })))

type Status = 'idle' | 'connecting' | 'live' | 'closed' | 'error'

/** Writes what is said, and any cards or slides the desk makes, into a chat so nothing is lost. */
function voiceThread() {
  const s0 = getState()
  // Continue the open chat if there is one; otherwise start a chat on the first thing said.
  let id: string | null = s0.view === 'chat' ? s0.activeThreadId : null
  const ensure = () => {
    const s = getState()
    if (!id || !s.threads.some((t) => t.id === id)) {
      const now = new Date().toISOString()
      id = uid()
      s.upsertThread({ id, title: 'Voice chat', createdAt: now, updatedAt: now, messages: [], sources: [], history: [] })
    }
    if (s.view !== 'chat' || s.activeThreadId !== id) s.openThread(id)
    return id
  }
  const mutate = (fn: (msgs: ChatMessage[]) => ChatMessage[]) => {
    const tid = ensure()
    const t = getState().threads.find((x) => x.id === tid)
    if (t) getState().upsertThread({ ...t, messages: fn([...t.messages]), updatedAt: new Date().toISOString() })
  }
  const lastOf = (msgs: ChatMessage[], role: ChatMessage['role']) => {
    const m = msgs[msgs.length - 1]
    if (m?.role === role) return m
    const next: ChatMessage = { id: uid(), role, parts: [], createdAt: new Date().toISOString() }
    msgs.push(next)
    return next
  }
  return {
    /** The chat so far as plain text, so a new voice session picks up where the last one left off. */
    history: () => {
      const t = getState().threads.find((x) => x.id === id)
      if (!t) return ''
      const cards = getState().cards
      const title = (cid?: string) => (cid && cards[cid] ? `${cards[cid].title} (idea ${cid})` : 'an idea')
      const lines = t.messages.map((m) => {
        const said = m.parts
          .map((p) => {
            if (p.type === 'text') return p.text?.trim() ?? ''
            if (p.type === 'ideas') return `[idea cards: ${(p.cardIds ?? []).map(title).join('; ')}]`
            if (p.type === 'deck') return `[built slides for ${title(p.cardId)}]`
            if (p.type === 'research') return `[research brief on: ${p.research?.question ?? ''}]`
            return ''
          })
          .filter(Boolean)
          .join(' ')
        return said && `${m.role === 'user' ? 'User' : 'Desk'}: ${said}`
      })
      return lines.filter(Boolean).join('\n').slice(-8000)
    },
    sources: () => getState().threads.find((x) => x.id === id)?.sources ?? [],
    saveSources: (sources: ChatThread['sources']) => {
      const t = getState().threads.find((x) => x.id === ensure())
      if (t) getState().upsertThread({ ...t, sources: [...sources] })
    },
    say: (who: 'user' | 'assistant', chunk: string) =>
      mutate((msgs) => {
        const m = lastOf(msgs, who)
        const last = m.parts[m.parts.length - 1]
        const parts = last?.type === 'text' ? [...m.parts.slice(0, -1), { ...last, text: (last.text ?? '') + chunk }] : [...m.parts, { type: 'text' as const, text: chunk.trimStart() }]
        return msgs.map((x) => (x.id === m.id ? { ...m, parts } : x))
      }),
    add: (p: ChatPart) =>
      mutate((msgs) => {
        const m = lastOf(msgs, 'assistant')
        return msgs.map((x) => (x.id === m.id ? { ...m, parts: [...m.parts, p] } : x))
      }),
    touch: () => id && mutate((msgs) => msgs.map((m) => ({ ...m, parts: [...m.parts] }))),
  }
}

export function Buddy() {
  const open = useStore((s) => s.voiceOpen)
  const setOpen = useStore((s) => s.setVoiceOpen)
  const view = useStore((s) => s.view)
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [level, setLevel] = useState({ in: 0, out: 0 })
  const [caption, setCaption] = useState('')
  const desk = useRef<LiveDesk | null>(null)

  const stop = () => {
    desk.current?.stop()
    desk.current = null
    setStatus('idle')
    setCaption('')
  }

  const start = async () => {
    if (!getState().apiKey) {
      setStatus('error')
      setDetail('Add your Gemini API key in Settings first.')
      return
    }
    setDetail(null)
    setStatus('connecting')
    const vt = voiceThread()
    const registry = [...vt.sources()]
    const { LiveDesk } = await import('../lib/live')
    let speaker: 'you' | 'desk' | null = null
    const d = new LiveDesk({
      onStatus: (s, why) => {
        setStatus(s === 'closed' ? 'idle' : s)
        if (why) setDetail(why)
        if (s !== 'live' && s !== 'connecting') desk.current = null
      },
      onTranscript: (who, text, final) => {
        if (final) {
          speaker = null
          return
        }
        if (!text) return
        if (who !== speaker) setCaption('')
        speaker = who
        setCaption((c) => (c + text).slice(-220))
        vt.say(who === 'you' ? 'user' : 'assistant', text)
      },
      onPart: (p) => {
        vt.add(p)
        vt.saveSources(registry)
      },
      onPartsChanged: () => {
        vt.touch()
        vt.saveSources(registry)
      },
      onLevel: (i, o) => setLevel({ in: i, out: o }),
    })
    desk.current = d
    try {
      await d.start(registry, vt.history())
    } catch (e) {
      setStatus('error')
      setDetail((e as Error).message)
      desk.current = null
    }
  }

  useEffect(() => {
    if (open && status === 'idle') void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => () => desk.current?.stop(), [])

  const live = status === 'live' || status === 'connecting'
  const bottom = view === 'chat' ? 'bottom-[150px]' : 'bottom-7'
  const talking = status === 'live' && level.out > 0.05
  const mood: ClayMood = status === 'connecting' ? 'connecting' : talking ? 'talking' : status === 'live' ? 'listening' : 'idle'
  const doing = status === 'connecting' ? 'Waking up…' : talking ? 'Talking…' : status === 'live' ? (muted ? 'Muted' : 'Listening…') : 'Talk it through'

  return (
    <div className={clsx('fixed right-7 z-30 flex flex-col items-end gap-3', bottom)}>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="pop w-[300px] rounded-2xl p-4"
          >
            <div className="flex items-center gap-2">
              <span className={clsx('size-2 rounded-full', status === 'live' ? 'bg-good' : status === 'connecting' ? 'animate-pulse bg-faint' : status === 'error' ? 'bg-bad' : 'bg-[#d4d5d8]')} />
              <span className="flex-1 text-[13.5px] font-medium">
                Clay <span className="font-normal text-muted">· {status === 'error' ? 'Couldn’t connect' : doing}</span>
              </span>
              <button
                aria-label="Close"
                onClick={() => {
                  stop()
                  setOpen(false)
                }}
                className="grid size-7 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-2.5 min-h-[60px] text-[14px] leading-snug text-ink-2">
              {caption || (status === 'error' ? detail : status === 'live' ? 'Say “give me ideas for today” or “research Zepto’s IPO”. Cards and slides appear in the chat.' : status === 'idle' ? (detail ?? 'Start a voice chat with the desk.') : '')}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex h-6 flex-1 items-center gap-[3px]">
                {Array.from({ length: 18 }, (_, i) => {
                  const v = Math.max(level.in, level.out)
                  const h = 4 + Math.abs(Math.sin(i * 1.7 + v * 9)) * v * 20
                  return <span key={i} className="w-[3px] rounded-full bg-ink/70 transition-[height] duration-75" style={{ height: live ? h : 4 }} />
                })}
              </div>
              {live ? (
                <>
                  <button
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    onClick={() => {
                      desk.current?.setMuted(!muted)
                      setMuted(!muted)
                    }}
                    className={clsx('grid size-9 place-items-center rounded-full ring-hair-strong', muted && 'bg-soft')}
                  >
                    {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                  <button aria-label="End" onClick={stop} className="grid size-9 place-items-center rounded-full bg-bad text-white">
                    <PhoneOff className="size-4" />
                  </button>
                </>
              ) : (
                <button onClick={() => void start()} className="h-9 rounded-full bg-ink px-4 text-[13.5px] font-medium text-white">
                  Start
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button aria-label="Talk live with Clay" onClick={() => setOpen(!open)} className="group flex flex-col items-center">
        <Suspense fallback={<span className="block" style={{ width: 60, height: 83 }} />}>
          <Clay3D size={60} level={live ? level.out : 0} mood={mood} />
        </Suspense>
        {/* Name card, like a butler's: always there during a voice chat, on hover otherwise. */}
        <span
          className={clsx(
            '-mt-0.5 rounded-[10px] bg-white px-2.5 py-1 text-center leading-tight ring-hair transition',
            live ? 'opacity-100' : 'pointer-events-none translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
          )}
        >
          <span className="block text-[12.5px] font-semibold text-ink">Clay</span>
          <span className="block whitespace-nowrap text-[11.5px] text-muted">{doing}</span>
        </span>
      </button>
    </div>
  )
}
