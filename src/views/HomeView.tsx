import { BarChart3, Briefcase, Calculator, Layers, LineChart, Sun } from 'lucide-react'
import { Composer } from '../components/Composer'
import { send } from '../lib/chat'
import { useStore } from '../lib/store'

const timeGreeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!'
}

const GREETINGS = [timeGreeting, () => 'What are we working on today?', () => 'Fresh day, fresh ideas.', () => 'What should BGCC post next?', () => 'What’s worth digging into?']

const CHIPS = [
  { icon: Sun, label: '3 ideas for today', text: 'Give me 3 ideas for today' },
  { icon: Calculator, label: 'Guesstimate', text: 'Give me a guesstimate idea from this week’s news' },
  { icon: Briefcase, label: 'Case breakdown', text: 'Give me a case breakdown idea from this week’s news' },
  { icon: Layers, label: 'Framework', text: 'Give me a consulting framework idea pegged to this week’s news' },
  { icon: LineChart, label: 'Industry analysis', text: 'Give me an industry analysis idea from this week’s news' },
  { icon: BarChart3, label: 'Poll', text: 'Give me an interactive poll idea from this week’s news' },
]

// A different greeting each time the app opens.
const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]()

export function HomeView() {
  const apiKey = useStore((s) => s.apiKey)
  const setView = useStore((s) => s.setView)
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col justify-center px-6 pt-16 pb-[8vh]">
      <div className="mb-7 flex items-center gap-3.5">
        <div className="grid size-10 place-items-center rounded-[10px] bg-ink text-[17px] font-semibold text-white">b</div>
        <h1 className="text-[24px] font-normal tracking-[-0.01em]">{greeting}</h1>
      </div>
      {!apiKey && (
        <button onClick={() => setView('settings')} className="mb-4 w-full rounded-[14px] bg-warn-soft px-4 py-3 text-left text-[14px] text-warn">
          Add your free Gemini API key in Settings to start. It stays in this browser. →
        </button>
      )}
      <div className="tray rounded-[20px] p-[3px] pb-3.5">
        <Composer variant="home" threadId={null} />
        <div className="mt-3.5 flex flex-wrap justify-center gap-2 px-2">
          {CHIPS.map(({ icon: Icon, label, text }) => (
            <button key={label} onClick={() => void send(null, text)} className="raise inline-flex items-center gap-[7px] rounded-[9px] bg-white px-3 py-1.5 text-[14px] font-medium">
              <Icon className="size-3.5 text-faint" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
