import { clear } from 'idb-keyval'
import { Check, ExternalLink, Eye, EyeOff, ImagePlus, RotateCcw, X } from 'lucide-react'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Input, Textarea } from '../components/ui'
import { DEFAULT_BRAND } from '../lib/brand'
import { DEFAULT_LIMITS, limitsFor, listModels, onLedgerChange, usage } from '../lib/gemini'
import { learnBrand, type ImageInput } from '../lib/learn'
import { FEEDS, relayUrl } from '../lib/sources'
import { useStore } from '../lib/store'

function Section({ title, body, children }: { title: string; body?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-black/[0.07] py-8 first:border-t-0 first:pt-0">
      <h2 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
      {body && <p className="mt-1 max-w-[620px] text-[14px] leading-relaxed text-muted">{body}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function SettingsView() {
  return (
    <div className="mx-auto max-w-[760px] px-6 pt-[120px] pb-[120px]">
      <h1 className="text-[28px] font-normal tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 mb-10 text-[14.5px] text-muted">Everything is stored in this browser only. There is no server and no account.</p>
      <KeySection />
      <BrandSection />
      <RelaySection />
      <QuotaSection />
      <Section title="Data" body="Remove every idea, chat and setting from this browser.">
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm('Delete all BGCC Desk data from this browser?')) return
            await clear()
            localStorage.clear()
            location.reload()
          }}
        >
          Clear all data
        </Button>
      </Section>
    </div>
  )
}

function KeySection() {
  const { apiKey, setApiKey, setView } = useStore()
  const [draft, setDraft] = useState(apiKey)
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setTesting(true)
    setError(null)
    try {
      const found = await listModels(draft.trim())
      setCount(found.length)
      const first = !apiKey
      setApiKey(draft.trim())
      if (first) setTimeout(() => setView('home'), 900)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }
  return (
    <Section
      title="Gemini API key"
      body={
        <>
          Bring your own key from Google AI Studio; the free tier is enough.{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ink underline underline-offset-2">
            Get a key <ExternalLink className="size-3" />
          </a>
        </>
      }
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input type={show ? 'text' : 'password'} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="AIza…" className="pr-10" onKeyDown={(e) => e.key === 'Enter' && draft.trim() && save()} />
          <button onClick={() => setShow(!show)} className="absolute top-1/2 right-3 -translate-y-1/2 text-faint hover:text-ink" aria-label="Show or hide the key">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button variant="dark" className="h-10" loading={testing} disabled={!draft.trim()} onClick={save}>
          Verify and save
        </Button>
        {apiKey && (
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => {
              setApiKey('')
              setDraft('')
              setCount(null)
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {error && <p className="mt-2.5 text-[13.5px] text-bad">{error}</p>}
      {count != null && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[13.5px] text-good">
          <Check className="size-4" /> Key works · {count} models available
        </p>
      )}
      {apiKey && count == null && !error && <p className="mt-2.5 text-[13.5px] text-faint">A key is saved.</p>}
    </Section>
  )
}

const readImage = (f: File) =>
  new Promise<ImageInput & { url: string }>((res) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      res({ url, mime: f.type || 'image/png', data: url.split(',')[1] })
    }
    r.readAsDataURL(f)
  })

function BrandSection() {
  const { brand, setBrand } = useStore()
  const [captions, setCaptions] = useState('')
  const [images, setImages] = useState<(ImageInput & { url: string })[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const learn = async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const { summary } = await learnBrand(captions, images)
      setNote(summary)
      setCaptions('')
      setImages([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const LISTS: [keyof typeof brand, string][] = [
    ['voice', 'Voice'],
    ['hookPatterns', 'Hooks that fit'],
    ['dos', 'Do'],
    ['donts', 'Don’t'],
  ]
  return (
    <Section
      title="BGCC’s voice"
      body="Every idea and post is written in this voice. Teach it from real posts: paste captions or add screenshots of BGCC’s LinkedIn and Instagram posts. You can also drop screenshots into the chat and say “learn our tone from these”."
    >
      <Textarea rows={4} value={captions} onChange={(e) => setCaptions(e.target.value)} placeholder="Paste a few past captions, one after another…" />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {images.map((im, i) => (
          <span key={i} className="group relative">
            <img src={im.url} alt="" className="size-14 rounded-[10px] object-cover ring-hair" />
            <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full bg-ink text-white group-hover:grid" aria-label="Remove">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[9px] px-3 text-[13.5px] font-medium ring-hair-strong hover:bg-hover">
          <ImagePlus className="size-4" /> Add screenshots
          <input type="file" accept="image/*" multiple hidden onChange={async (e) => setImages([...images, ...(await Promise.all([...(e.target.files ?? [])].slice(0, 12).map(readImage)))])} />
        </label>
        <span className="flex-1" />
        <Button variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => confirm('Reset the voice to the default profile?') && setBrand({ ...DEFAULT_BRAND })}>
          Reset
        </Button>
        <Button variant="dark" loading={busy} disabled={!captions.trim() && !images.length} onClick={learn}>
          Learn from these
        </Button>
      </div>
      {note && <p className="mt-3 rounded-[10px] bg-good-soft px-3.5 py-2.5 text-[13.5px] text-good">{note}</p>}
      {error && <p className="mt-3 text-[13.5px] text-bad">{error}</p>}
      <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {LISTS.map(([k, label]) => (
          <div key={k}>
            <h3 className="mb-1.5 text-[13px] text-faint">{label}</h3>
            <ul className="space-y-1 text-[13.5px] leading-snug text-ink-2">
              {(brand[k] as string[]).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[13px] text-faint">
        Hashtags: {brand.hashtags.join(' ')} · Updated {brand.updatedAt}
      </p>
    </Section>
  )
}

function RelaySection() {
  const { settings, updateSettings } = useStore()
  const [draft, setDraft] = useState(settings.relay)
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const test = async () => {
    setState('testing')
    try {
      const url = relayUrl(draft.trim(), FEEDS.find((f) => f.id === 'inc42')!.url)
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      const ok = res.ok && (await res.text()).includes('<item')
      setState(ok ? 'ok' : 'fail')
      if (ok) updateSettings({ relay: draft.trim() })
    } catch {
      setState('fail')
    }
  }
  return (
    <Section
      title="News feed relay"
      body="Google Search, Hacker News and Wikipedia work straight from the browser. Indian business-press feeds (ET, Mint, Inc42, YourStory and others) block browsers, so they need a tiny free relay: deploy relay/worker.js to Cloudflare Workers and paste its URL."
    >
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://bgcc-relay.yourname.workers.dev" />
        <Button className="h-10" loading={state === 'testing'} onClick={test}>
          Test and save
        </Button>
      </div>
      <p className="mt-2.5 text-[13.5px]">
        {state === 'ok' && <span className="text-good">Relay works · {FEEDS.length - 1} more feeds unlocked</span>}
        {state === 'fail' && <span className="text-bad">Could not read a feed through that URL</span>}
        {state === 'idle' && (
          <span className="text-faint">
            {settings.relay ? `Using ${settings.relay}` : import.meta.env.DEV ? 'Using the built-in development relay' : 'No relay yet: scans use Google Search, Hacker News and Wikipedia only'}
          </span>
        )}
      </p>
    </Section>
  )
}

function QuotaSection() {
  const { settings, updateSettings } = useStore()
  const ledger = JSON.parse(useSyncExternalStore(onLedgerChange, () => JSON.stringify(usage()))) as ReturnType<typeof usage>
  const models = [...new Set([...Object.keys(DEFAULT_LIMITS), ...Object.keys(ledger.used)])].filter((m) => !m.includes(':'))
  return (
    <Section title="Free-tier usage today" body="Daily counts reset at midnight Pacific (12:30 pm IST). Limits follow AI Studio’s rate-limit page; edit them if Google changes them.">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-left text-[12.5px] text-faint">
            <th className="pb-2 font-normal">Model</th>
            <th className="pb-2 font-normal">Used</th>
            <th className="pb-2 font-normal">Per minute</th>
            <th className="pb-2 font-normal">Per day</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const lim = limitsFor(m)
            const set = (p: Partial<{ rpm: number; rpd: number }>) => updateSettings({ limits: { ...settings.limits, [m]: { ...lim, ...p } } })
            const out = ledger.exhausted[m] || ledger.exhausted[`search:${m}`]
            return (
              <tr key={m} className="border-t border-black/[0.06]">
                <td className="py-2 pr-4">{m}</td>
                <td className="tabular py-2 pr-4">
                  {ledger.used[m] ?? 0}
                  {out && <span className="ml-2 text-[12.5px] text-warn">{ledger.exhausted[m] ? 'used up' : 'search used up'}</span>}
                </td>
                <td className="py-2 pr-4">
                  <input type="number" min={1} value={lim.rpm} onChange={(e) => set({ rpm: Number(e.target.value) || 1 })} className="tabular h-8 w-20 rounded-lg px-2 ring-hair-strong" />
                </td>
                <td className="py-2">
                  <input type="number" min={1} value={lim.rpd} onChange={(e) => set({ rpd: Number(e.target.value) || 1 })} className="tabular h-8 w-24 rounded-lg px-2 ring-hair-strong" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}
