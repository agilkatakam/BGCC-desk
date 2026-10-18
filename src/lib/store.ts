import { del, get, set } from 'idb-keyval'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_BRAND } from './brand'
import { setApiKey, setLimitOverrides } from './gemini'
import type { BrandProfile, ChatThread, FormatId, IdeaCard, PaletteId, ScanRun, StyleId } from './types'

export type View = 'home' | 'chat' | 'ideas' | 'history' | 'settings'

export interface Settings {
  relay: string
  limits: Record<string, { rpm: number; rpd: number }>
}

/** Composer choices, sent with every message so the desk doesn't have to ask. */
export interface Prefs {
  format: FormatId | 'auto'
  palette: PaletteId | 'ask'
  style: StyleId | 'ask'
}

interface State {
  apiKey: string
  settings: Settings
  brand: BrandProfile
  runs: ScanRun[]
  cards: Record<string, IdeaCard>
  threads: ChatThread[]
  prefs: Prefs
  // session-only
  view: View
  activeThreadId: string | null
  studioCardId: string | null
  openIdeaId: string | null
  voiceOpen: boolean
  hydrated: boolean

  setView: (v: View) => void
  setApiKey: (k: string) => void
  updateSettings: (p: Partial<Settings>) => void
  setBrand: (b: BrandProfile) => void
  setPrefs: (p: Partial<Prefs>) => void
  upsertCard: (c: IdeaCard) => void
  patchCard: (id: string, p: Partial<IdeaCard>) => void
  deleteCard: (id: string) => void
  upsertRun: (r: ScanRun) => void
  upsertThread: (t: ChatThread) => void
  deleteThread: (id: string) => void
  openThread: (id: string | null) => void
  openStudio: (id: string | null) => void
  openIdea: (id: string | null) => void
  setVoiceOpen: (v: boolean) => void
}

const idbStorage = createJSONStorage(() => ({
  getItem: async (name: string) => (await get(name)) ?? null,
  setItem: (name: string, value: string) => set(name, value),
  removeItem: (name: string) => del(name),
}))

export const useStore = create<State>()(
  persist(
    (setState) => ({
      apiKey: '',
      settings: { relay: '', limits: {} },
      brand: DEFAULT_BRAND,
      runs: [],
      cards: {},
      threads: [],
      prefs: { format: 'auto', palette: 'ask', style: 'ask' },
      view: 'home',
      activeThreadId: null,
      studioCardId: null,
      openIdeaId: null,
      voiceOpen: false,
      hydrated: false,

      setView: (view) => setState({ view }),
      setApiKey: (apiKey) => {
        setApiKey(apiKey)
        setState({ apiKey })
      },
      updateSettings: (p) =>
        setState((s) => {
          const settings = { ...s.settings, ...p }
          setLimitOverrides(settings.limits)
          return { settings }
        }),
      setBrand: (brand) => setState({ brand }),
      setPrefs: (p) => setState((s) => ({ prefs: { ...s.prefs, ...p } })),
      upsertCard: (c) => setState((s) => ({ cards: { ...s.cards, [c.id]: c } })),
      patchCard: (id, p) => setState((s) => (s.cards[id] ? { cards: { ...s.cards, [id]: { ...s.cards[id], ...p } } } : s)),
      deleteCard: (id) =>
        setState((s) => {
          const cards = { ...s.cards }
          delete cards[id]
          return { cards, studioCardId: s.studioCardId === id ? null : s.studioCardId, openIdeaId: s.openIdeaId === id ? null : s.openIdeaId }
        }),
      upsertRun: (r) => setState((s) => ({ runs: [r, ...s.runs.filter((x) => x.id !== r.id)].slice(0, 8) })),
      upsertThread: (t) => setState((s) => ({ threads: [t, ...s.threads.filter((x) => x.id !== t.id)] })),
      deleteThread: (id) =>
        setState((s) => ({
          threads: s.threads.filter((t) => t.id !== id),
          activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
        })),
      openThread: (id) => setState({ activeThreadId: id, view: id ? 'chat' : 'home', openIdeaId: null }),
      openStudio: (studioCardId) => setState({ studioCardId, openIdeaId: null }),
      openIdea: (openIdeaId) => setState({ openIdeaId }),
      setVoiceOpen: (voiceOpen) => setState({ voiceOpen }),
    }),
    {
      name: 'bgcc-desk-v2',
      storage: idbStorage,
      partialize: (s) => ({
        apiKey: s.apiKey,
        settings: s.settings,
        brand: s.brand,
        runs: s.runs,
        cards: s.cards,
        threads: s.threads,
        prefs: s.prefs,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!state.prefs.style) state.prefs = { ...state.prefs, style: 'ask' }
          // A newer built-in voice replaces an older one.
          if ((state.brand.updatedAt ?? '') < DEFAULT_BRAND.updatedAt) state.brand = { ...DEFAULT_BRAND }
          setApiKey(state.apiKey)
          setLimitOverrides(state.settings.limits)
        }
        useStore.setState({ hydrated: true })
      },
    },
  ),
)

export const getState = () => useStore.getState()

if (import.meta.env.DEV) (window as any).__desk = useStore
