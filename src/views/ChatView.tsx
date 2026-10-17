import { AlertCircle, ChevronLeft, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Composer } from '../components/Composer'
import { Part } from '../components/Parts'
import { send, useRunning } from '../lib/chat'
import { useStore } from '../lib/store'
import type { ChatMessage, ChatThread } from '../lib/types'

export function ChatView() {
  const id = useStore((s) => s.activeThreadId)
  const thread = useStore((s) => s.threads.find((t) => t.id === id))
  const openThread = useStore((s) => s.openThread)
  const busy = useRunning((s) => Boolean(id && s.busy[id]))
  const stick = useRef(true)

  // Follow the reply while it streams, unless the user scrolled up to read.
  useEffect(() => {
    const onScroll = () => (stick.current = window.innerHeight + window.scrollY > document.body.scrollHeight - 160)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // Scroll to the true bottom: the page's bottom padding keeps the last line clear of the composer.
  const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight)
  const count = thread?.messages.length ?? 0
  const seen = useRef(count)
  useEffect(() => {
    // A new message (yours, or the reply starting) always brings the chat down with it.
    if (count > seen.current) {
      stick.current = true
      requestAnimationFrame(toBottom)
    } else if (stick.current) toBottom()
    seen.current = count
  }, [thread, count])
  useEffect(() => {
    stick.current = true
    toBottom()
  }, [id])

  if (!thread) {
    return (
      <div className="mx-auto max-w-[760px] px-6 pt-32 text-center text-muted">
        This chat is gone.{' '}
        <button className="underline" onClick={() => openThread(null)}>
          Start a new one
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-[760px] px-6 pt-24 pb-56">
        <button onClick={() => openThread(null)} className="mb-7 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
          <ChevronLeft className="size-[15px]" />
          Home
        </button>
        {thread.messages.map((m, i) => (
          <Message key={m.id} m={m} thread={thread} last={i === thread.messages.length - 1} busy={busy} />
        ))}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-b from-transparent via-white via-40% to-white px-6 pt-8 pb-6">
        <div className="mx-auto max-w-[712px]">
          <Composer variant="dock" threadId={thread.id} />
        </div>
      </div>
    </>
  )
}

function Message({ m, thread, last, busy }: { m: ChatMessage; thread: ChatThread; last: boolean; busy: boolean }) {
  if (m.role === 'user') {
    const text = m.parts.find((p) => p.type === 'text')?.text
    return (
      <div className="mb-7">
        {m.parts
          .filter((p) => p.type === 'files')
          .map((p, i) => (
            <Part key={i} part={p} threadId={thread.id} sources={thread.sources} live={false} />
          ))}
        {text && <div className="ml-auto w-fit max-w-[75%] rounded-2xl bg-soft px-4 py-2.5 whitespace-pre-wrap">{text.replace(/\s*\[idea [a-z0-9]+\]$/, '')}</div>}
      </div>
    )
  }
  const working = last && busy
  const prevUser = thread.messages[thread.messages.indexOf(m) - 1]
  return (
    <div className="mb-9">
      {m.parts.map((p, i) => (
        <Part key={i} part={p} threadId={thread.id} sources={thread.sources} live={last} />
      ))}
      {working && !m.parts.some((p) => (p.type === 'tool' && p.tool?.status === 'running') || (p.type === 'progress' && !p.progress?.done) || (p.type === 'research' && !['done', 'error'].includes(p.research?.status ?? '')) || p.type === 'text') && (
        <div className="flex items-center gap-2 text-[14px] text-muted">
          <Loader2 className="size-[15px] animate-spin" />
          <span className="shimmer">Thinking</span>
        </div>
      )}
      {m.error && (
        <div className="mt-2 flex items-start gap-2.5 rounded-xl bg-bad-soft px-4 py-3 text-[14px] text-bad">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{m.error}</span>
          {last && prevUser && (
            <button
              className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
              onClick={() => void send(thread.id, prevUser.parts.find((p) => p.type === 'text')?.text ?? '')}
            >
              <RotateCcw className="size-3.5" /> Try again
            </button>
          )}
        </div>
      )}
      {last && !busy && m.followUps?.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {m.followUps.map((q) => (
            <button key={q} onClick={() => void send(thread.id, q)} className="raise rounded-[10px] px-3 py-1.5 text-left text-[13.5px] text-ink-2">
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
