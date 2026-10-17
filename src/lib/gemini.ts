import type { SourceRef } from './types'

const API = 'https://generativelanguage.googleapis.com/v1beta'

export type Role = 'writer' | 'critic' | 'scout' | 'search' | 'bulk' | 'chat' | 'deep' | 'synth' | 'vision' | 'live'

// Ordered preferences per job. The first model the key can see wins; on a
// daily-quota 429 the call falls through to the next one.
export const ROLE_CANDIDATES: Record<Role, string[]> = {
  writer: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'],
  critic: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'],
  deep: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'],
  // Research reports: best writer first, but never dead-end when Flash quota runs out.
  synth: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'],
  // Grounded Google Search. On the free tier the 2.5 models carry the search allowance; 3.x models
  // often answer search requests with a bare 429, so they are only a fallback.
  search: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
  scout: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'],
  chat: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'],
  vision: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
  bulk: ['gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  live: [
    'gemini-3.8-live',
    'gemini-3-flash-live',
    'gemini-3.1-flash-live-preview',
    'gemini-2.5-flash-native-audio-preview-12-2025',
  ],
}

// Free-tier defaults from the AI Studio rate-limit page (RPM, RPD). Editable in Settings.
export const DEFAULT_LIMITS: Record<string, { rpm: number; rpd: number }> = {
  'gemini-3.8-flash': { rpm: 5, rpd: 20 },
  'gemini-3.7-flash': { rpm: 5, rpd: 20 },
  'gemini-3.6-flash': { rpm: 5, rpd: 20 },
  'gemini-3.5-flash-lite': { rpm: 15, rpd: 500 },
  'gemini-3.5-flash': { rpm: 5, rpd: 20 },
  // Google cut these to 20 a day on many free keys (Oct 2026); edit in Settings if yours allows more.
  'gemini-2.5-flash': { rpm: 10, rpd: 20 },
  'gemini-2.5-flash-lite': { rpm: 15, rpd: 20 },
  'gemini-3.1-flash-lite': { rpm: 15, rpd: 500 },
  'gemma-4-31b-it': { rpm: 30, rpd: 14400 },
  'gemma-4-26b-a4b-it': { rpm: 30, rpd: 14400 },
}
const FALLBACK_LIMIT = { rpm: 5, rpd: 20 }

export class GeminiError extends Error {
  status: number
  daily: boolean
  retryAfterMs: number
  constructor(message: string, status: number, daily = false, retryAfterMs = 0) {
    super(message)
    this.status = status
    this.daily = daily
    this.retryAfterMs = retryAfterMs
  }
}

// ---------- key + model discovery ----------

let apiKey = ''
let available: Set<string> | null = null
let liveCapable: Set<string> | null = null

export function setApiKey(key: string) {
  if (key !== apiKey) {
    apiKey = key
    available = null
    liveCapable = null
  }
}
export const hasKey = () => apiKey.length > 0
export const getApiKey = () => apiKey

export async function listModels(key = apiKey): Promise<{ id: string; live: boolean }[]> {
  const out: { id: string; live: boolean }[] = []
  let pageToken = ''
  do {
    const res = await fetch(`${API}/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, {
      headers: { 'x-goog-api-key': key },
    })
    if (!res.ok) throw await toError(res)
    const body = await res.json()
    for (const m of body.models ?? []) {
      const methods: string[] = m.supportedGenerationMethods ?? []
      out.push({ id: String(m.name).replace(/^models\//, ''), live: methods.includes('bidiGenerateContent') })
    }
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return out
}

async function ensureModels() {
  if (available) return
  try {
    const models = await listModels()
    available = new Set(models.map((m) => m.id))
    liveCapable = new Set(models.filter((m) => m.live).map((m) => m.id))
  } catch {
    available = new Set() // unknown: fall back to trying candidates in order
    liveCapable = new Set()
  }
}

export async function candidatesFor(role: Role): Promise<string[]> {
  await ensureModels()
  const prefs = ROLE_CANDIDATES[role]
  const pool = role === 'live' ? liveCapable! : available!
  if (pool.size === 0) return prefs
  const hits = prefs.filter((m) => pool.has(m))
  if (hits.length) return hits
  if (role === 'live') {
    const anyLive = [...pool].find((m) => /live|native-audio/.test(m))
    return anyLive ? [anyLive] : prefs
  }
  return prefs
}

// ---------- quota ledger ----------

type Ledger = { day: string; used: Record<string, number>; exhausted: Record<string, boolean> }
const LEDGER_KEY = 'bgcc.quota'
let limitOverrides: Record<string, { rpm: number; rpd: number }> = {}

export function setLimitOverrides(o: Record<string, { rpm: number; rpd: number }>) {
  limitOverrides = o
}
export const limitsFor = (model: string) => limitOverrides[model] ?? DEFAULT_LIMITS[model] ?? FALLBACK_LIMIT

// Gemini daily quotas reset at midnight Pacific.
function pacificDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

function readLedger(): Ledger {
  try {
    const l = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '') as Ledger
    if (l.day === pacificDay()) return l
  } catch {
    /* fresh ledger */
  }
  return { day: pacificDay(), used: {}, exhausted: {} }
}
const writeLedger = (l: Ledger) => {
  localStorage.setItem(LEDGER_KEY, JSON.stringify(l))
  ledgerListeners.forEach((fn) => fn())
}
const ledgerListeners = new Set<() => void>()
export function onLedgerChange(fn: () => void) {
  ledgerListeners.add(fn)
  return () => ledgerListeners.delete(fn)
}
export function usage() {
  return readLedger()
}

function record(model: string) {
  const l = readLedger()
  l.used[model] = (l.used[model] ?? 0) + 1
  writeLedger(l)
}
function markExhausted(model: string) {
  const l = readLedger()
  l.exhausted[model] = true
  writeLedger(l)
}
function isSpent(model: string, search = false) {
  const l = readLedger()
  return l.exhausted[model] || (search && l.exhausted[`search:${model}`]) || (l.used[model] ?? 0) >= limitsFor(model).rpd
}

// Space requests per model so we never trip the per-minute limit.
const nextSlot: Record<string, number> = {}
async function waitForSlot(model: string) {
  const gap = 60000 / limitsFor(model).rpm + 250
  const now = Date.now()
  const at = Math.max(now, nextSlot[model] ?? 0)
  nextSlot[model] = at + gap
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

// ---------- generateContent ----------

export interface GenerateOptions {
  role: Role
  system?: string
  prompt?: string
  contents?: unknown[]
  search?: boolean
  urlContext?: boolean
  functions?: unknown[]
  schema?: object
  temperature?: number
  avoid?: string // prefer a different model than this one (critic ≠ writer)
  signal?: AbortSignal
  plainJson?: boolean // ask for JSON in the prompt instead of via responseJsonSchema
  onText?: (fullText: string) => void // stream the answer; called with the text so far
}

export interface GenerateResult {
  model: string
  text: string
  json?: any
  sources: SourceRef[]
  searchQueries: string[]
  // Every grounding chunk in API order, plus which text spans each one backs.
  chunks: SourceRef[]
  supports: { text: string; chunks: number[] }[]
  content: any // the model turn, verbatim, for multi-turn history
  functionCalls: { name: string; args: any; id?: string }[]
}

// Model → time until which it is tried last (it recently answered 503 or timed out).
const struggling = new Map<string, number>()

// How long to wait for an answer before trying the next model. Long writing jobs get more time.
const TIMEOUT_MS: Partial<Record<Role, number>> = { writer: 180_000, deep: 180_000, synth: 180_000, critic: 120_000, chat: 60_000, scout: 60_000, bulk: 90_000, vision: 60_000 }

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  if (!apiKey) throw new GeminiError('Add your Gemini API key in Settings first.', 401)
  let models = await candidatesFor(opts.search ? 'search' : opts.role)
  if (opts.avoid) models = [...models.filter((m) => m !== opts.avoid), ...models.filter((m) => m === opts.avoid)]
  // Models that were overloaded or too slow a moment ago go last, so one bad model doesn't cost minutes per call.
  const cool = (m: string) => (struggling.get(m) ?? 0) > Date.now()
  models = [...models.filter((m) => !cool(m)), ...models.filter(cool)]
  const usable = models.filter((m) => !isSpent(m, opts.search))
  if (!usable.length) {
    throw new GeminiError(
      `Today's free quota is used up for ${models.join(', ')}. It resets at midnight Pacific (12:30 pm IST).`,
      429,
      true,
    )
  }
  let lastErr: unknown
  for (const model of usable) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callModel(model, opts)
      } catch (err) {
        lastErr = err
        if (!(err instanceof GeminiError)) throw err
        if (err.status === 429 && err.daily) {
          markExhausted(model)
          break
        }
        // A bare 429 (no retry hint) on a search call means this model has no search allowance left.
        if (err.status === 429 && !err.retryAfterMs && opts.search) {
          markExhausted(`search:${model}`)
          break
        }
        // Per-minute limit: move on to the next model if there is one, otherwise wait it out once.
        if (err.status === 429 && model !== usable[usable.length - 1]) break
        if (err.status === 429 && attempt === 0 && err.retryAfterMs && err.retryAfterMs <= 65000) {
          await new Promise((r) => setTimeout(r, err.retryAfterMs))
          continue
        }
        if (err.status === 400 && opts.schema && !opts.plainJson && /schema|json/i.test(err.message)) {
          return callModel(model, { ...opts, plainJson: true })
        }
        // Overload is often momentary: one short pause and retry before moving on.
        if (err.status === 503 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 3000))
          continue
        }
        if (err.status === 503 || err.status === 504) struggling.set(model, Date.now() + 10 * 60_000)
        if (err.status === 404 || err.status === 429 || err.status >= 500) break
        throw err
      }
    }
  }
  throw lastErr
}

async function callModel(model: string, opts: GenerateOptions): Promise<GenerateResult> {
  const isGemma = model.startsWith('gemma')
  let contents = opts.contents ?? [{ role: 'user', parts: [{ text: opts.prompt ?? '' }] }]
  const body: any = { contents, generationConfig: { temperature: opts.temperature ?? 0.7 } }

  if (opts.system) {
    if (isGemma) {
      // Fold the system prompt into the first user turn; Gemma follows it reliably there.
      const [first, ...rest] = contents as any[]
      contents = [{ ...first, parts: [{ text: `${opts.system}\n\n---\n\n` }, ...first.parts] }, ...rest]
      body.contents = contents
    } else {
      body.systemInstruction = { parts: [{ text: opts.system }] }
    }
  }

  const tools: any[] = []
  if (opts.search) tools.push({ google_search: {} })
  if (opts.urlContext) tools.push({ url_context: {} })
  if (opts.functions?.length) tools.push({ functionDeclarations: opts.functions })
  if (tools.length) body.tools = tools

  if (opts.schema && !tools.length && !isGemma && !opts.plainJson) {
    body.generationConfig.responseMimeType = 'application/json'
    body.generationConfig.responseJsonSchema = opts.schema
  } else if (opts.schema && Object.keys(opts.schema).length) {
    const last = contents[contents.length - 1] as any
    contents = [...contents.slice(0, -1), { ...last, parts: [...last.parts, { text: `\n\nReturn ONLY valid JSON matching this JSON Schema, with no prose:\n${JSON.stringify(opts.schema)}` }] }]
    body.contents = contents
  }

  await waitForSlot(model)
  const stream = Boolean(opts.onText)
  // When Google is overloaded a request can hang for minutes. Give up after a while so the next model gets a go;
  // for a stream, the limit covers the wait for it to start.
  const ctl = new AbortController()
  const onAbort = () => ctl.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', onAbort)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, TIMEOUT_MS[opts.role] ?? 90_000)
  let cand: any
  try {
    const res = await fetch(`${API}/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    record(model)
    if (!res.ok) throw await toError(res)
    if (stream) clearTimeout(timer)
    cand = stream ? await readStream(res, opts.onText!) : (await res.json()).candidates?.[0]
  } catch (err) {
    if (timedOut) throw new GeminiError(`${model} took too long to answer.`, 504)
    throw err
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  const parts: any[] = cand?.content?.parts ?? []
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
  const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall)

  const meta = cand?.groundingMetadata
  const sources: SourceRef[] = []
  const seen = new Set<string>()
  for (const chunk of meta?.groundingChunks ?? []) {
    const uri = chunk.web?.uri
    if (uri && !seen.has(uri)) {
      seen.add(uri)
      sources.push({ title: chunk.web.title ?? new URL(uri).hostname, url: uri, source: chunk.web.title })
    }
  }

  const chunks: SourceRef[] = (meta?.groundingChunks ?? []).map((c: any) => ({
    title: c.web?.title ?? 'source',
    url: c.web?.uri ?? '',
    source: c.web?.title,
  }))
  const supports = (meta?.groundingSupports ?? []).map((s: any) => ({
    text: s.segment?.text ?? '',
    chunks: s.groundingChunkIndices ?? [],
  }))

  let json: any
  if (opts.schema) {
    json = parseJsonLoose(text)
    if (json === undefined && !functionCalls.length) {
      throw new GeminiError(`${model} returned text that isn't valid JSON.`, 502)
    }
  }

  if (!text && !functionCalls.length && cand?.finishReason && cand.finishReason !== 'STOP') {
    throw new GeminiError(`${model} stopped early (${cand.finishReason}).`, 502)
  }

  return {
    model,
    text,
    json,
    sources,
    searchQueries: meta?.webSearchQueries ?? [],
    chunks,
    supports,
    content: cand?.content ?? { role: 'model', parts: [] },
    functionCalls,
  }
}

/** Reads an SSE stream into one candidate, merging text parts but keeping signed parts intact. */
async function readStream(res: Response, onText: (t: string) => void): Promise<any> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const parts: any[] = []
  let meta: any
  let finishReason: string | undefined
  let buf = ''
  let shown = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      let chunk: any
      try {
        chunk = JSON.parse(line.slice(5))
      } catch {
        continue
      }
      const c = chunk.candidates?.[0]
      if (!c) continue
      if (c.groundingMetadata) meta = c.groundingMetadata
      if (c.finishReason) finishReason = c.finishReason
      for (const p of c.content?.parts ?? []) {
        const last = parts[parts.length - 1]
        const plain = typeof p.text === 'string' && !p.thought && !p.thoughtSignature
        if (plain && last && typeof last.text === 'string' && !last.thought && !last.thoughtSignature) last.text += p.text
        else parts.push({ ...p })
        if (typeof p.text === 'string' && !p.thought) {
          shown += p.text
          onText(shown)
        }
      }
    }
  }
  return { content: { role: 'model', parts }, groundingMetadata: meta, finishReason }
}

async function toError(res: Response): Promise<GeminiError> {
  let message = `Gemini API error ${res.status}`
  let daily = false
  let retryAfterMs = 0
  try {
    const body = await res.json()
    message = body.error?.message ?? message
    for (const d of body.error?.details ?? []) {
      if (d['@type']?.includes('QuotaFailure')) {
        daily = (d.violations ?? []).some((v: any) => /PerDay/i.test(v.quotaId ?? ''))
      }
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
        retryAfterMs = parseFloat(d.retryDelay) * 1000
      }
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 400 && /API key/i.test(message)) message = 'That API key was rejected by Google. Check it in Settings.'
  return new GeminiError(message, res.status, daily, retryAfterMs)
}

export function parseJsonLoose(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    /* fall through to bracket scan */
  }
  const start = cleaned.search(/[[{]/)
  if (start < 0) return undefined
  const open = cleaned[start]
  const close = open === '{' ? '}' : ']'
  const end = cleaned.lastIndexOf(close)
  if (end <= start) return undefined
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return undefined
  }
}
