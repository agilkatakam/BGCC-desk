import clsx from 'clsx'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PaceBadge, SourceRef } from '../lib/types'
import { hostOf } from '../lib/url'

type Variant = 'dark' | 'outline' | 'ghost' | 'danger'

export function Button({
  variant = 'outline',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-colors select-none disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-[13.5px]',
        variant === 'dark' && 'bg-ink text-white hover:bg-[#2a2a2a]',
        variant === 'outline' && 'ring-hair-strong hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-ink',
        variant === 'danger' && 'text-bad hover:bg-bad-soft',
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      {...rest}
      className={clsx('h-10 w-full rounded-[10px] bg-white px-3 text-[14px] ring-hair-strong placeholder:text-ghost focus:shadow-[0_0_0_2px_#111] focus:outline-none', className)}
    />
  )
})

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={clsx(
        'w-full resize-none rounded-[10px] bg-white px-3 py-2.5 text-[14px] leading-relaxed ring-hair-strong placeholder:text-ghost focus:shadow-[0_0_0_2px_#111] focus:outline-none',
        className,
      )}
    />
  )
}

export function Tag({ tone = 'plain', children, className, title }: { tone?: 'plain' | 'dark' | 'up' | 'warn' | 'bad'; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[12.5px] leading-[1.35] whitespace-nowrap',
        tone === 'plain' && 'bg-soft text-ink-2',
        tone === 'dark' && 'bg-ink text-white',
        tone === 'up' && 'bg-good-soft text-good',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function PaceTag({ pace, growth }: { pace?: PaceBadge; growth?: number | null }) {
  if (!pace || pace === 'Unmeasured') return null
  const up = pace === 'Exploding' || pace === 'Rising'
  return (
    <Tag tone={up ? 'up' : 'plain'} title="Wikipedia and Hacker News attention, last 7 days vs the 3 weeks before">
      {up && '▲ '}
      {pace === 'Cooling' && '▼ '}
      {pace}
      {growth && up ? ` ${growth.toFixed(1)}×` : ''}
    </Tag>
  )
}


const sourceHost = (s: SourceRef) => {
  const h = hostOf(s.url)
  // Grounding links go through a Google redirect; the title carries the real domain.
  return h.includes('vertexaisearch') || h.includes('google.com') ? s.title.toLowerCase() : h
}

const HUES = ['#e8572a', '#1f6feb', '#c0392b', '#2d6a4f', '#7c3aed', '#0e7490', '#b45309', '#111']
const hue = (s: string) => HUES[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]

/** A row of little lettered source marks: "I M ET 3 sources". */
export function SourceMarks({ sources, onClick }: { sources: SourceRef[]; onClick?: () => void }) {
  const hosts = [...new Set(sources.map(sourceHost).filter(Boolean))]
  if (!hosts.length) return null
  return (
    <button onClick={onClick} className="flex items-center gap-[5px] text-[12.5px] text-faint hover:text-ink">
      {hosts.slice(0, 4).map((h) => (
        <i key={h} title={h} className="grid size-[15px] place-items-center rounded-[4px] text-[7px] font-bold text-white not-italic" style={{ background: hue(h) }}>
          {h.replace(/^(m\.|in\.|economictimes\.)/, '').slice(0, h.startsWith('economictimes') ? 2 : 1).toUpperCase()}
        </i>
      ))}
      <span className="ml-0.5">
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </span>
    </button>
  )
}

export function SourceList({ sources, numbered }: { sources: SourceRef[]; numbered?: boolean }) {
  return (
    <ol className="space-y-1.5">
      {sources.map((s, i) => (
        <li key={`${s.url}-${i}`} className="flex gap-2.5 text-[13.5px] leading-snug">
          {numbered && <span className="tabular w-5 shrink-0 text-right text-faint">{i + 1}</span>}
          <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 hover:underline">
            <span className="text-ink-2">{s.title || sourceHost(s)}</span>
            <span className="ml-1.5 text-faint">{sourceHost(s)}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

/** A small dropdown anchored to its trigger. */
export function Menu<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  align = 'left',
  up,
}: {
  label: string
  value: T
  options: { value: T; label: string; hint?: string; swatch?: ReactNode }[]
  onChange: (v: T) => void
  icon?: ReactNode
  align?: 'left' | 'right'
  up?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const cur = options.find((o) => o.value === value)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={clsx('inline-flex h-[34px] items-center gap-[7px] rounded-[9px] px-2.5 text-[14px] text-muted hover:bg-hover', open && 'bg-hover')}
      >
        {cur?.swatch ?? icon}
        {label} <b className="font-medium text-ink">{cur?.label}</b>
        <ChevronDown className="size-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: up ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: up ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            className={clsx('pop absolute z-30 w-64 rounded-xl p-1.5', up ? 'bottom-full mb-1.5' : 'top-full mt-1.5', align === 'right' ? 'right-0' : 'left-0')}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover"
              >
                {o.swatch && <span className="mt-[3px]">{o.swatch}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug">{o.label}</span>
                  {o.hint && <span className="block text-[12.5px] leading-snug text-faint">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="mt-[3px] size-3.5" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/25 p-6 pt-[8vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={clsx('pop relative w-full rounded-2xl', wide ? 'max-w-[880px]' : 'max-w-[640px]')}
          >
            <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function Swatch({ ink, accent, size = 14 }: { ink: string; accent: string; size?: number }) {
  return <i className="inline-block shrink-0 rounded-[4px]" style={{ width: size, height: size, background: `linear-gradient(135deg, ${ink} 55%, ${accent} 55%)` }} />
}

