import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'

export function HistoryView() {
  const threads = useStore((s) => s.threads)
  const { openThread, deleteThread } = useStore()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    return [...threads]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((t) => !k || t.title.toLowerCase().includes(k) || t.messages.some((m) => m.parts.some((p) => p.text?.toLowerCase().includes(k))))
  }, [threads, q])

  return (
    <div className="mx-auto max-w-[760px] px-6 pt-[120px] pb-[120px]">
      <h1 className="text-[28px] font-normal tracking-[-0.02em]">History</h1>
      <p className="mt-1 text-[14.5px] text-muted">Past conversations with the desk.</p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search chats"
        className="mt-6 h-10 w-full rounded-[10px] px-3.5 text-[14.5px] ring-hair-strong placeholder:text-ghost focus:shadow-[0_0_0_2px_#111] focus:outline-none"
      />
      <ul className="mt-4">
        {list.map((t) => {
          const replies = t.messages.filter((m) => m.role === 'user').length
          return (
            <li key={t.id} className="group flex items-center rounded-[12px] hover:bg-hover">
              <button onClick={() => openThread(t.id)} className="min-w-0 flex-1 px-3.5 py-3 text-left">
                <div className="truncate text-[15px]">{t.title}</div>
                <div className="mt-0.5 text-[13px] text-faint">
                  {new Date(t.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {replies} message{replies === 1 ? '' : 's'}
                </div>
              </button>
              <button
                aria-label="Delete chat"
                onClick={() => deleteThread(t.id)}
                className="mr-2 hidden size-8 place-items-center rounded-lg text-faint group-hover:grid hover:bg-white hover:text-bad"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          )
        })}
      </ul>
      {!list.length && <p className="mt-16 text-center text-[14.5px] text-faint">{q ? 'No chats match.' : 'No chats yet.'}</p>}
    </div>
  )
}
