import clsx from 'clsx'
import { ArrowUp, CornerDownLeft, FileText, LayoutGrid, Mic, Square, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { InlineFile } from '../lib/agent'
import { PALETTES, PALETTE_IDS } from '../lib/brand'
import { readFiles, send, stopThread, useRunning } from '../lib/chat'
import { FORMATS, FORMAT_IDS } from '../lib/scoring'
import { useStore } from '../lib/store'
import type { Attachment, FormatId, PaletteId, StyleId } from '../lib/types'
import { LOOKS } from '../slides/looks'
import { Menu, Swatch } from './ui'

type Picked = { inline: InlineFile; meta: Attachment }

/** The message box. "home" is the big centred one; "dock" sits at the bottom of a chat. */
export function Composer({ variant, threadId }: { variant: 'home' | 'dock'; threadId: string | null }) {
  const { prefs, setPrefs, setVoiceOpen } = useStore()
  const busy = useRunning((s) => Boolean(threadId && s.busy[threadId]))
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Picked[]>([])
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(variant === 'home' ? 220 : 180, Math.max(variant === 'home' ? 54 : 26, el.scrollHeight))}px`
  }, [text, variant])

  const add = async (list: File[]) => {
    setError(null)
    try {
      const picked = await readFiles(list)
      setFiles((f) => [...f, ...picked].slice(0, 8))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const submit = () => {
    if (busy || (!text.trim() && !files.length)) return
    void send(threadId, text, files)
    setText('')
    setFiles([])
  }

  const formatMenu = (
    <Menu<FormatId | 'auto'>
      label="Format"
      up={variant === 'dock'}
      icon={<LayoutGrid className="size-[15px]" />}
      value={prefs.format}
      onChange={(format) => setPrefs({ format })}
      options={[
        { value: 'auto', label: 'Auto', hint: 'The desk picks the best format for each idea' },
        ...FORMAT_IDS.map((f) => ({ value: f, label: FORMATS[f].short, hint: FORMATS[f].blurb })),
      ]}
    />
  )
  const styleMenu = (
    <Menu<StyleId | 'ask'>
      label="Style"
      up={variant === 'dock'}
      value={prefs.style}
      onChange={(style) => setPrefs({ style })}
      options={[
        { value: 'ask', label: 'Ask me', hint: 'Preview the cover in each style before building' },
        ...(Object.keys(LOOKS) as StyleId[]).map((st) => ({ value: st, label: LOOKS[st].label, hint: LOOKS[st].blurb })),
      ]}
    />
  )
  const paletteMenu = (
    <Menu<PaletteId | 'ask'>
      label="Palette"
      up={variant === 'dock'}
      value={prefs.palette}
      onChange={(palette) => setPrefs({ palette })}
      options={[
        { value: 'ask', label: 'Ask me', hint: 'Choose colours before each build', swatch: <i className="inline-block size-3.5 rounded-[4px] ring-hair-strong" /> },
        ...PALETTE_IDS.map((p) => ({ value: p, label: PALETTES[p].label, swatch: <Swatch ink={PALETTES[p].palette.ink} accent={PALETTES[p].palette.accent} /> })),
      ]}
    />
  )

  const box = (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void add([...e.dataTransfer.files])
      }}
      className={clsx(
        'box rounded-[18px] transition-shadow',
        variant === 'home' ? 'py-3 pr-3 pl-3.5' : 'py-2 pr-2 pl-4',
        drag && 'shadow-[0_0_0_2px_#111]',
      )}
    >
      <input ref={picker} type="file" multiple hidden accept="image/*,application/pdf,.txt,.md,.csv,.json" onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ''))} />
      {variant === 'home' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => picker.current?.click()} className="inline-flex h-[34px] items-center gap-2 rounded-[9px] px-3 text-[14px] font-medium ring-hair-strong hover:bg-hover">
            <Upload className="size-4" />
            Upload screenshot
          </button>
          {formatMenu}
          {styleMenu}
          {paletteMenu}
        </div>
      )}
      {files.length > 0 && (
        <div className={clsx('flex flex-wrap gap-2', variant === 'home' ? 'mb-3' : 'mt-1 mb-2')}>
          {files.map((f, i) => (
            <span key={i} className="group relative flex h-12 items-center gap-2 rounded-[10px] bg-soft pr-3 text-[13px]">
              {f.meta.thumb ? <img src={f.meta.thumb} alt="" className="h-12 w-12 rounded-[10px] object-cover" /> : <FileText className="ml-3 size-4 text-muted" />}
              <span className="max-w-36 truncate">{f.meta.name}</span>
              <button aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full bg-ink text-white group-hover:grid">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={clsx(variant === 'dock' && 'flex items-end gap-1.5')}>
        <textarea
          ref={ta}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const imgs = [...e.clipboardData.files]
            if (imgs.length) {
              e.preventDefault()
              void add(imgs)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={variant === 'home' ? 'Ask for post ideas, or research a topic: “what’s happening with Zepto’s IPO?”' : 'Reply, or say “build the first one”…'}
          className={clsx(
            'block w-full resize-none border-0 bg-transparent px-0.5 outline-none placeholder:text-ghost',
            variant === 'home' ? 'text-[17px]' : 'mb-[5px] self-center text-[15.5px]',
          )}
        />
        {variant === 'dock' && (
          <>
            <IconBtn title="Attach images or files" onClick={() => picker.current?.click()}>
              <Upload className="size-[17px]" />
            </IconBtn>
            <IconBtn title="Talk it through" onClick={() => setVoiceOpen(true)}>
              <Mic className="size-[18px]" />
            </IconBtn>
            {busy ? (
              <button onClick={() => threadId && stopThread(threadId)} className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ink text-white" title="Stop">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button onClick={submit} disabled={!text.trim() && !files.length} className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ink text-white disabled:bg-[#d4d5d8]" title="Send">
                <ArrowUp className="size-[18px]" />
              </button>
            )}
          </>
        )}
      </div>
      {variant === 'home' && (
        <div className="mt-1 flex items-center gap-2.5">
          <span className="flex-1" />
          <IconBtn title="Talk it through" onClick={() => setVoiceOpen(true)}>
            <Mic className="size-[18px]" />
          </IconBtn>
          <button onClick={submit} disabled={!text.trim() && !files.length} className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-ink px-4 text-[14.5px] font-medium text-white hover:bg-[#2a2a2a] disabled:opacity-40">
            <CornerDownLeft className="size-4" />
            Generate
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div>
      {variant === 'dock' && (
        <div className="mb-2 flex items-center gap-0.5 px-1">
          {formatMenu}
          {styleMenu}
          {paletteMenu}
        </div>
      )}
      {box}
      {error && <p className="mt-2 px-2 text-[13px] text-bad">{error}</p>}
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-hover hover:text-ink">
      {children}
    </button>
  )
}
