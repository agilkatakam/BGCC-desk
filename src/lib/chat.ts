import { create } from 'zustand'
import { chatTurn, type InlineFile } from './agent'
import { getState } from './store'
import type { Attachment, ChatMessage, ChatPart, ChatThread } from './types'
import { uid } from './writer'

// Turns in flight, by thread. Session-only.
interface Running {
  busy: Record<string, AbortController>
}
export const useRunning = create<Running>(() => ({ busy: {} }))
if (import.meta.env.DEV) (window as any).__running = useRunning

const setBusy = (id: string, c: AbortController | null) =>
  useRunning.setState((s) => {
    const busy = { ...s.busy }
    if (c) busy[id] = c
    else delete busy[id]
    return { busy }
  })

export const stopThread = (id: string) => useRunning.getState().busy[id]?.abort()

const TEXT_MIME = /^(text\/|application\/(json|csv|xml|x-yaml|markdown))/

const readAs = (f: File, how: 'dataURL' | 'text') =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    if (how === 'text') r.readAsText(f)
    else r.readAsDataURL(f)
  })

async function thumbOf(dataUrl: string): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const k = Math.min(1, 160 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.75)
}

/** Reads dropped or picked files: images and PDFs go to the model as-is, text files as text. */
export async function readFiles(files: File[]): Promise<{ inline: InlineFile; meta: Attachment }[]> {
  const out: { inline: InlineFile; meta: Attachment }[] = []
  for (const f of files.slice(0, 8)) {
    const mime = f.type || (f.name.endsWith('.md') ? 'text/markdown' : 'application/octet-stream')
    if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is over 15 MB.`)
    if (TEXT_MIME.test(mime) || /\.(txt|md|csv|json)$/i.test(f.name)) {
      const text = await readAs(f, 'text')
      out.push({ inline: { mime, name: f.name, data: '', text }, meta: { name: f.name, mime } })
    } else if (mime.startsWith('image/') || mime === 'application/pdf') {
      const url = await readAs(f, 'dataURL')
      out.push({
        inline: { mime, name: f.name, data: url.split(',')[1] },
        meta: { name: f.name, mime, thumb: mime.startsWith('image/') ? await thumbOf(url).catch(() => undefined) : undefined },
      })
    } else {
      throw new Error(`${f.name}: only images, PDFs and text files can be attached.`)
    }
  }
  return out
}

const titleFrom = (text: string, files: Attachment[]) => {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return files[0]?.name ?? 'New chat'
  return t.length > 60 ? `${t.slice(0, 57).replace(/\s\S*$/, '')}…` : t
}

function save(thread: ChatThread) {
  getState().upsertThread({ ...thread, updatedAt: new Date().toISOString() })
}

/** Sends a message in a thread (or starts one) and runs the desk until it replies. Returns the thread id. */
export async function send(threadId: string | null, text: string, files: { inline: InlineFile; meta: Attachment }[] = []): Promise<string> {
  const { threads, prefs, openThread } = getState()
  const now = new Date().toISOString()
  let thread: ChatThread = (threadId && threads.find((t) => t.id === threadId)) || {
    id: uid(),
    title: titleFrom(text, files.map((f) => f.meta)),
    createdAt: now,
    updatedAt: now,
    messages: [],
    sources: [],
    history: [],
  }
  if (useRunning.getState().busy[thread.id]) return thread.id

  // Answering a question marks it answered so the chips lock.
  const messages = thread.messages.map((m, i) =>
    i === thread.messages.length - 1 && m.role === 'assistant'
      ? { ...m, followUps: undefined, parts: m.parts.map((p) => (p.type === 'ask' && p.ask && !p.ask.answer ? { ...p, ask: { ...p.ask, answer: text } } : p)) }
      : m,
  )
  const userParts: ChatPart[] = []
  if (files.length) userParts.push({ type: 'files', files: files.map((f) => f.meta) })
  if (text.trim()) userParts.push({ type: 'text', text: text.trim() })
  const user: ChatMessage = { id: uid(), role: 'user', parts: userParts, createdAt: now }
  const reply: ChatMessage = { id: uid(), role: 'assistant', parts: [], createdAt: now }
  thread = { ...thread, messages: [...messages, user, reply] }
  save(thread)
  if (getState().activeThreadId !== thread.id) openThread(thread.id)

  const ctrl = new AbortController()
  setBusy(thread.id, ctrl)
  // Sources are shared across the thread so [n] stays stable; tools register into this array.
  const registry = [...thread.sources]
  const update = (parts: ChatPart[], followUps: string[], extra: Partial<ChatMessage> = {}) => {
    const cur = getState().threads.find((t) => t.id === thread.id) ?? thread
    thread = {
      ...cur,
      sources: [...registry],
      messages: cur.messages.map((m) => (m.id === reply.id ? { ...m, parts, followUps: followUps.length ? followUps : m.followUps, ...extra } : m)),
    }
    save(thread)
  }
  let last: ChatPart[] = []
  let lastFollow: string[] = []
  // Streaming calls this per token; every save also persists, so batch to ~6 a second.
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    update(last, lastFollow)
  }
  try {
    const out = await chatTurn({
      history: thread.history,
      text: text.trim() || '(see attachment)',
      files: files.map((f) => f.inline),
      prefs,
      registry,
      signal: ctrl.signal,
      onUpdate: (parts, followUps) => {
        last = parts
        lastFollow = followUps
        timer ??= setTimeout(flush, 160)
      },
    })
    if (timer) clearTimeout(timer)
    update(out.parts, out.followUps)
    thread = { ...thread, history: out.history }
    save(thread)
  } catch (err) {
    if (timer) clearTimeout(timer)
    const aborted = ctrl.signal.aborted
    update(last, lastFollow, { error: aborted ? undefined : (err as Error).message })
  } finally {
    setBusy(thread.id, null)
  }
  return thread.id
}

/** Sends from a button: into the open chat if there is one, otherwise a new chat. */
export function act(text: string) {
  const { view, activeThreadId } = getState()
  void send(view === 'chat' ? activeThreadId : null, text)
}
