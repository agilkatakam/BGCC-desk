import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { listModels } from '../lib/gemini'
import { useStore } from '../lib/store'

/** Slow golden motes drifting through a soft flow field, leaving faint trails. */
function Field() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let raf = 0
    const dpr = Math.min(devicePixelRatio, 2)
    const resize = () => {
      w = c.clientWidth
      h = c.clientHeight
      c.width = w * dpr
      c.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#060606'
      ctx.fillRect(0, 0, w, h)
    }
    resize()
    addEventListener('resize', resize)
    const motes = Array.from({ length: 420 }, () => ({ x: Math.random() * w, y: Math.random() * h, life: Math.random() * 400 }))
    const angle = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0021 + t * 0.00011) * 1.6 + Math.cos(y * 0.0027 - t * 0.00008) * 1.6 + Math.sin((x + y) * 0.0009 + t * 0.00005)
    const frame = (t: number) => {
      ctx.fillStyle = 'rgba(6,6,6,0.055)'
      ctx.fillRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      for (const m of motes) {
        const a = angle(m.x, m.y, t)
        const nx = m.x + Math.cos(a) * 0.55
        const ny = m.y + Math.sin(a) * 0.55
        const d = Math.hypot(nx - cx, ny - cy) / Math.max(w, h)
        ctx.strokeStyle = `rgba(245,197,24,${Math.max(0.05, 0.42 - d * 0.7)})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        m.x = nx
        m.y = ny
        if (--m.life < 0 || m.x < -10 || m.x > w + 10 || m.y < -10 || m.y > h + 10) {
          m.x = Math.random() * w
          m.y = Math.random() * h
          m.life = 200 + Math.random() * 400
        }
      }
      if (!still) raf = requestAnimationFrame(frame)
    }
    if (still) for (let i = 0; i < 240; i++) frame(i * 16)
    else raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 size-full" aria-hidden />
}

const STEPS = [
  <>
    Open{' '}
    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[#F5C518] underline underline-offset-4">
      Google AI Studio
    </a>
  </>,
  <>Create a free API key</>,
  <>Paste it here</>,
]

export function WelcomeView() {
  const { setApiKey, setView } = useStore()
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await listModels(draft.trim())
      setView('home')
      setApiKey(draft.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#060606] text-white">
      <Field />
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[520px] -translate-1/2 animate-[breathe_7s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.16),transparent_65%)]" />
      <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-8 grid size-11 place-items-center rounded-[11px] bg-white text-[18px] font-semibold text-black">b</div>
        <h1 className="font-serif text-[clamp(34px,5vw,56px)] leading-[1.05] font-normal tracking-[-0.02em]">
          The desk is waiting
          <span className="text-[#F5C518]">.</span>
        </h1>
        <p className="mt-4 max-w-[440px] text-[15.5px] leading-relaxed text-white/60">
          BITS Goa Consulting Club's research and content desk. It finds today's stories worth posting and turns them into fact-checked carousels.
        </p>

        <ol className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[14px] text-white/75">
          {STEPS.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="grid size-6 place-items-center rounded-full border border-white/20 text-[12px] text-white/90">{i + 1}</span>
              {s}
              {i < STEPS.length - 1 && <span className="ml-1 text-white/25">·</span>}
            </li>
          ))}
        </ol>

        <div className="mt-6 flex w-full max-w-[460px] items-center gap-1.5 rounded-[14px] border border-white/15 bg-white/[0.06] p-1.5 backdrop-blur-md focus-within:border-[#F5C518]/60">
          <input
            type={show ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Paste your Gemini key (AIza…)"
            aria-label="Gemini API key"
            className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[14.5px] text-white outline-none placeholder:text-white/35"
          />
          <button onClick={() => setShow(!show)} className="px-1.5 text-white/40 hover:text-white" aria-label="Show or hide the key">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
          <button
            onClick={save}
            disabled={!draft.trim() || busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#F5C518] px-4 text-[14px] font-semibold text-black transition disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Enter'}
            <ArrowRight className="size-4" />
          </button>
        </div>
        <p className={`mt-3 min-h-5 text-[13px] ${error ? 'text-red-400' : 'text-white/35'}`}>
          {error ?? 'Free tier is enough. Your key stays in this browser; there is no server.'}
        </p>
      </div>
    </div>
  )
}
