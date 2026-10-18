import clsx from 'clsx'
import { History, LayoutGrid, Plus, Settings } from 'lucide-react'
import { useEffect } from 'react'
import { Buddy } from './components/Buddy'
import { IdeaModal } from './components/IdeaCard'
import { useStore, type View } from './lib/store'
import { ChatView } from './views/ChatView'
import { HistoryView } from './views/HistoryView'
import { HomeView } from './views/HomeView'
import { IdeasView } from './views/IdeasView'
import { SettingsView } from './views/SettingsView'
import { StudioView } from './views/StudioView'

function Nav({ on, onClick, icon, children, title }: { on?: boolean; onClick: () => void; icon: React.ReactNode; children?: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={clsx(
        'inline-flex h-9 items-center gap-[7px] rounded-[9px] text-[14px]',
        children ? 'px-3' : 'w-9 justify-center',
        on ? 'bg-soft font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export default function App() {
  const { view, setView, openThread, hydrated, apiKey } = useStore()

  useEffect(() => {
    if (hydrated && !apiKey && view === 'home') setView('settings')
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  if (!hydrated) return null
  const go = (v: View) => setView(v)

  return (
    <div className="min-h-full">
      <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center gap-1 bg-white/90 px-7 backdrop-blur">
        <button onClick={() => openThread(null)} className={clsx('mr-auto flex items-center gap-2.5 text-[15px] font-semibold', view === 'home' && 'invisible')}>
          <span className="grid size-7 place-items-center rounded-[7px] bg-ink text-[13px] text-white">b</span>
          BGCC Desk
        </button>
        <Nav on={view === 'home'} onClick={() => openThread(null)} icon={<Plus className="size-[15px]" />}>
          New chat
        </Nav>
        <Nav on={view === 'ideas'} onClick={() => go('ideas')} icon={<LayoutGrid className="size-[15px]" />}>
          Previous ideas
        </Nav>
        <Nav on={view === 'history' || view === 'chat'} onClick={() => go('history')} icon={<History className="size-[15px]" />}>
          History
        </Nav>
        <Nav on={view === 'settings'} onClick={() => go('settings')} icon={<Settings className="size-[17px]" />} title="Settings" />
      </header>

      <main className={clsx(view === 'home' && 'flex min-h-screen')}>
        {view === 'home' && <HomeView />}
        {view === 'chat' && <ChatView />}
        {view === 'ideas' && <IdeasView />}
        {view === 'history' && <HistoryView />}
        {view === 'settings' && <SettingsView />}
      </main>

      <Buddy />
      <IdeaModal />
      <StudioView />
    </div>
  )
}
