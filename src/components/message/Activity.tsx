// Хід роботи Hermes: інструменти, міркування, помічники, доповнення — згортається, коли відповідь готова.
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  Code2,
  Eye,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  MessageSquarePlus,
  Search,
  Sparkles,
  SquareTerminal,
  Users,
  Wrench,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { plural } from '../../schedule.ts'
import { usePrefs } from '../../prefs.ts'
import type { Message, Part } from '../../shared.ts'
import { Markdown } from '../Markdown.tsx'
import { ApprovalCard, ClarifyCard } from './Prompts.tsx'

const TOOLS: [RegExp, LucideIcon, string][] = [
  [/^(terminal|shell|process|bash)/, SquareTerminal, 'Термінал'],
  [/search/, Search, 'Пошук'],
  [/^(web|browser|fetch|http)/, Globe, 'Веб'],
  [/^(read_file|search_files|list|ls)/, FileText, 'Читання файлів'],
  [/^(write_file|patch|edit)/, FilePen, 'Зміна файлів'],
  [/^vision|image/, Eye, 'Зображення'],
  [/^(execute_code|code)/, Code2, 'Код'],
  [/^(delegate|subagent)/, Users, 'Помічники'],
  [/memory/, Brain, 'Пам’ять'],
  [/^skill/, Sparkles, 'Навички'],
  [/todo/, ListTodo, 'План'],
  [/clarify/, CircleHelp, 'Питання'],
]

/** mcp__firered_tts__synthesize_speech → «firered tts: synthesize speech». */
function prettyTool(tool: string) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  const human = (x: string) => x.replace(/_+/g, ' ').trim()
  return mcp ? `${human(mcp[1]!)}: ${human(mcp[2]!)}` : human(tool)
}

export function toolMeta(tool: string): [LucideIcon, string] {
  if (!tool.startsWith('mcp__')) for (const [re, icon, label] of TOOLS) if (re.test(tool)) return [icon, label]
  return [Wrench, prettyTool(tool)]
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} хв ${s % 60} с`
  return `${Math.floor(m / 60)} год ${m % 60} хв`
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function ActivityRow({ p }: { p: Part }) {
  const [open, setOpen] = useState(false)
  if (p.type === 'tool') {
    const [Icon, label] = toolMeta(p.tool)
    return (
      <div className={`act-row act-tool is-${p.status}`}>
        <button type="button" className="act-line" onClick={() => setOpen((o) => !o)} disabled={!p.result && p.preview.length < 90}>
          <span className="act-icon">{p.status === 'running' ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}</span>
          <span className="act-label">{label}</span>
          {p.preview && <span className="act-preview">{p.preview}</span>}
          {p.status === 'error' && <AlertTriangle size={14} className="act-err-icon" />}
          {typeof p.duration === 'number' && p.duration >= 1 && <span className="act-dur">{formatDuration(p.duration * 1000)}</span>}
        </button>
        {open && (
          <div className="act-detail">
            {p.preview && <pre>{p.preview}</pre>}
            {p.result && <pre className="act-result">{p.result}</pre>}
          </div>
        )}
      </div>
    )
  }
  if (p.type === 'text') {
    return (
      <div className="act-row act-text">
        <Markdown text={p.text} />
      </div>
    )
  }
  if (p.type === 'reasoning') {
    return (
      <div className="act-row act-reasoning">
        <Brain size={15} />
        <span>{p.text}</span>
      </div>
    )
  }
  if (p.type === 'subagent') {
    return (
      <div className={`act-row act-tool is-${p.status}`}>
        <div className="act-line">
          <span className="act-icon">{p.status === 'running' ? <Loader2 size={15} className="spin" /> : <Users size={15} />}</span>
          <span className="act-label">Помічник</span>
          <span className="act-preview">{p.summary || p.goal}</span>
        </div>
      </div>
    )
  }
  if (p.type === 'steer') {
    return (
      <div className="act-row act-steer">
        <MessageSquarePlus size={15} />
        <span>Ти додав: {p.text}</span>
      </div>
    )
  }
  return null
}

/** Ключ кроку: власний id, якщо є, інакше місце в повідомленні (не в уже відфільтрованому списку). */
function partKey(m: Message, p: Part): string {
  if (p.type === 'tool' || p.type === 'subagent') return `${p.type}:${p.id}`
  if (p.type === 'approval' || p.type === 'clarify') return `${p.type}:${p.promptId}`
  return `${p.type}:${m.parts.indexOf(p)}`
}

export function Activity({ m, parts, active }: { m: Message; parts: Part[]; active: boolean }) {
  const { expandActivity } = usePrefs()
  const [open, setOpen] = useState(active || expandActivity)
  // Під час роботи хід видно одразу; коли Hermes закінчив, згортаємо, як ChatGPT (якщо в налаштуваннях не просили лишати).
  useEffect(() => {
    setOpen(active || expandActivity)
  }, [active, expandActivity])
  const now = useNow(active)
  const steps = parts.filter((p) => p.type === 'tool' || p.type === 'subagent').length
  const elapsed = (m.finishedAt ?? now) - m.createdAt
  if (!parts.length && !active) return null
  const current = [...parts].reverse().find((p) => p.type === 'tool' && p.status === 'running') as
    | Extract<Part, { type: 'tool' }>
    | undefined
  const title = active
    ? m.status === 'queued'
      ? 'У черзі'
      : m.status === 'stopping'
        ? 'Зупиняю'
        : current
          ? toolMeta(current.tool)[1]
          : 'Працює'
    : `Працював ${formatDuration(elapsed)}`
  return (
    <div className={`activity ${open ? 'is-open' : ''}`}>
      <button type="button" className="activity-head" onClick={() => setOpen((o) => !o)}>
        <span className={`activity-title ${active ? 'shimmer' : ''}`}>{title}</span>
        <span className="activity-meta">
          {active && ` · ${formatDuration(elapsed)}`}
          {steps > 0 && ` · ${steps} ${plural(steps, 'дія', 'дії', 'дій')}`}
        </span>
        {parts.length > 0 && <ChevronRight size={16} className="activity-chevron" />}
      </button>
      {open && parts.length > 0 && (
        <div className="activity-body">
          {parts.map((p) =>
            p.type === 'approval' ? (
              <ApprovalCard key={partKey(m, p)} m={m} p={p} />
            ) : p.type === 'clarify' ? (
              <ClarifyCard key={partKey(m, p)} m={m} p={p} />
            ) : (
              <ActivityRow key={partKey(m, p)} p={p} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
