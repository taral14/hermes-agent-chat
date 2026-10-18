import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Code2,
  Download,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FilePen,
  FileSpreadsheet,
  FileText,
  FileVideo,
  GitBranch,
  Globe,
  ListTodo,
  Loader2,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, uploadUrl } from '../api.ts'
import type { Attachment, Message, Part } from '../shared.ts'
import { AudioPlayer } from './AudioPlayer.tsx'
import { CopyButton, Markdown } from './Markdown.tsx'

const ACTIVE = new Set(['queued', 'running', 'stopping'])

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

function toolMeta(tool: string): [LucideIcon, string] {
  if (!tool.startsWith('mcp__')) for (const [re, icon, label] of TOOLS) if (re.test(tool)) return [icon, label]
  return [Wrench, prettyTool(tool)]
}

function formatDuration(ms: number) {
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

// ---------- Користувач ----------

function fileKind(mime: string, name: string): { label: string; color: string; Icon: LucideIcon } {
  const ext = name.split('.').pop()?.toUpperCase() ?? ''
  if (mime === 'application/pdf') return { label: 'PDF', color: '#e5484d', Icon: FileText }
  if (mime.startsWith('audio/')) return { label: ext || 'АУДІО', color: '#8e4ec6', Icon: FileAudio }
  if (mime.startsWith('video/')) return { label: ext || 'ВІДЕО', color: '#e54666', Icon: FileVideo }
  if (/zip|compressed|tar|gzip/.test(mime)) return { label: ext || 'АРХІВ', color: '#6f6f6f', Icon: FileArchive }
  if (/sheet|csv|excel/.test(mime)) return { label: ext || 'ТАБЛИЦЯ', color: '#10a37f', Icon: FileSpreadsheet }
  if (/word|text|markdown|json|epub|presentation/.test(mime)) return { label: ext || 'ДОКУМЕНТ', color: '#0285ff', Icon: FileText }
  return { label: ext || 'ФАЙЛ', color: '#6f6f6f', Icon: FileIcon }
}

function formatSize(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}

function FileCard({ a }: { a: Attachment }) {
  const { label, color, Icon } = fileKind(a.mime, a.name)
  return (
    <div className="att-file">
      <a href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="att-file-open">
        <span className="att-file-icon" style={{ background: color }}>
          <Icon size={18} />
        </span>
        <span className="att-file-text">
          <span className="att-file-name">{a.name}</span>
          <span className="att-file-meta">
            {label} · {formatSize(a.size)}
          </span>
        </span>
      </a>
      <a href={`${uploadUrl(a.id)}?download`} download={a.name} className="icon-btn" title="Завантажити" aria-label="Завантажити">
        <Download size={16} />
      </a>
    </div>
  )
}

function Attachments({ items, side }: { items: Attachment[]; side: 'user' | 'assistant' }) {
  if (!items.length) return null
  return (
    <div className={`msg-attachments is-${side}`}>
      {items.map((a) =>
        a.mime.startsWith('image/') ? (
          <a key={a.id} href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="att-image">
            <img src={uploadUrl(a.id)} alt={a.name} loading="lazy" />
          </a>
        ) : a.mime.startsWith('audio/') ? (
          <AudioPlayer key={a.id} a={a} />
        ) : a.mime.startsWith('video/') ? (
          <div key={a.id} className="att-media att-video">
            <video controls playsInline preload="metadata" src={uploadUrl(a.id)} />
            <FileCard a={a} />
          </div>
        ) : (
          <FileCard key={a.id} a={a} />
        ),
      )}
    </div>
  )
}

// ---------- Дії над повідомленнями (лише чати на рідному протоколі) ----------

export type MessageActions = {
  /** Чат на рідному протоколі й Hermes зараз не працює. */
  enabled: boolean
  retry: (m: Message) => Promise<void>
  edit: (m: Message, text: string) => Promise<void>
  branch: (m: Message) => Promise<void>
}

export const ActionsContext = createContext<MessageActions | null>(null)

function ActionButton({ label, onClick, children }: { label: string; onClick: () => Promise<void> | void; children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onClick()
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 size={16} className="spin" /> : children}
    </button>
  )
}

function UserMessage({ m }: { m: Message }) {
  const actions = useContext(ActionsContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [draft, editing])
  const canEdit = Boolean(actions?.enabled && m.turn && m.text && !m.text.startsWith('/'))

  if (editing && actions) {
    return (
      <div className="msg msg-user">
        <div className="edit-box">
          <textarea ref={box} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="edit-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(false)
                setDraft(m.text)
              }}
            >
              Скасувати
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !draft.trim() || draft.trim() === m.text}
              onClick={async () => {
                setBusy(true)
                try {
                  await actions.edit(m, draft.trim())
                  setEditing(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? <Loader2 size={16} className="spin" /> : 'Надіслати'}
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="msg msg-user">
      <Attachments items={m.attachments} side="user" />
      {m.text && <div className={`bubble ${m.text.startsWith('/') ? 'is-command' : ''}`}>{m.text}</div>}
      {m.text && (
        <div className="msg-actions msg-actions-user">
          {canEdit && (
            <ActionButton
              label="Редагувати"
              onClick={() => {
                setDraft(m.text)
                setEditing(true)
              }}
            >
              <Pencil size={16} />
            </ActionButton>
          )}
          <CopyButton text={m.text} />
        </div>
      )}
    </div>
  )
}

// ---------- Запити на рішення ----------

const CHOICE_LABEL: Record<string, string> = {
  once: 'Дозволити',
  session: 'Дозволити в цьому чаті',
  always: 'Дозволяти завжди',
  deny: 'Відхилити',
}

function ApprovalCard({ m, p }: { m: Message; p: Extract<Part, { type: 'approval' }> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const answer = async (choice: string) => {
    setBusy(true)
    setErr('')
    try {
      await api.approval(m.id, p.promptId, p.generation, choice)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  if (p.state !== 'pending') {
    const denied = p.choice === 'deny'
    return (
      <div className={`prompt-done ${denied ? 'is-denied' : ''}`}>
        {denied ? <CircleX size={15} /> : p.choice ? <CircleCheck size={15} /> : <ShieldAlert size={15} />}
        <span>
          {p.auto ? 'Дозволено автоматично' : p.choice ? (denied ? 'Відхилено' : CHOICE_LABEL[p.choice] ?? p.choice) : 'Запит на дозвіл закрито'}:{' '}
          <code>{p.command}</code>
        </span>
      </div>
    )
  }
  const order = ['once', 'session', 'always', 'deny'].filter((c) => p.choices.includes(c))
  return (
    <div className="prompt-card">
      <div className="prompt-title">
        <ShieldAlert size={18} />
        <span>Hermes просить дозволу</span>
      </div>
      {p.description && <div className="prompt-desc">{p.description}</div>}
      <pre className="prompt-command">{p.command}</pre>
      <div className="prompt-actions">
        {order.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            className={c === 'once' ? 'btn btn-primary' : c === 'deny' ? 'btn btn-danger' : 'btn'}
            onClick={() => void answer(c)}
          >
            {CHOICE_LABEL[c] ?? c}
          </button>
        ))}
      </div>
      {err && <div className="prompt-err">{err}</div>}
    </div>
  )
}

function ClarifyCard({ m, p }: { m: Message; p: Extract<Part, { type: 'clarify' }> }) {
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const answer = async (value: string) => {
    if (!value.trim()) return
    setBusy(true)
    setErr('')
    try {
      await api.clarify(m.id, p.promptId, p.generation, value)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  if (p.state !== 'pending') {
    return (
      <div className="prompt-done">
        <CircleHelp size={15} />
        <span>
          {p.question}
          {p.answer ? <> — <b>{p.answer}</b></> : ' (без відповіді)'}
        </span>
      </div>
    )
  }
  return (
    <div className="prompt-card prompt-clarify">
      <div className="prompt-title">
        <CircleHelp size={18} />
        <span>Hermes уточнює</span>
      </div>
      <div className="prompt-question">
        <Markdown text={p.question} />
      </div>
      {p.choices.length > 0 && (
        <div className="prompt-actions">
          {p.choices.map((c) =>
            p.multi ? (
              <button
                key={c}
                type="button"
                className={`btn ${picked.includes(c) ? 'btn-selected' : ''}`}
                disabled={busy}
                onClick={() => setPicked((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}
              >
                {c}
              </button>
            ) : (
              <button key={c} type="button" className="btn" disabled={busy} onClick={() => void answer(c)}>
                {c}
              </button>
            ),
          )}
          {p.multi && (
            <button type="button" className="btn btn-primary" disabled={busy || !picked.length} onClick={() => void answer(picked.join(', '))}>
              Відповісти
            </button>
          )}
        </div>
      )}
      <form
        className="prompt-input"
        onSubmit={(e) => {
          e.preventDefault()
          void answer(text)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Своя відповідь…" disabled={busy} />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
          Надіслати
        </button>
      </form>
      {err && <div className="prompt-err">{err}</div>}
    </div>
  )
}

// ---------- Хід роботи ----------

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

function Activity({ m, parts, active }: { m: Message; parts: Part[]; active: boolean }) {
  const [open, setOpen] = useState(active)
  // Під час роботи хід видно одразу; коли Hermes закінчив, згортаємо, як ChatGPT.
  useEffect(() => {
    setOpen(active)
  }, [active])
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
          {steps > 0 && ` · ${steps} ${steps === 1 ? 'дія' : steps < 5 ? 'дії' : 'дій'}`}
        </span>
        {parts.length > 0 && <ChevronRight size={16} className="activity-chevron" />}
      </button>
      {open && parts.length > 0 && (
        <div className="activity-body">
          {parts.map((p, i) =>
            p.type === 'approval' ? (
              <ApprovalCard key={i} m={m} p={p} />
            ) : p.type === 'clarify' ? (
              <ClarifyCard key={i} m={m} p={p} />
            ) : (
              <ActivityRow key={i} p={p} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Асистент ----------

function splitParts(m: Message): { activity: Part[]; answer: string } {
  const prompts = new Set(['approval', 'clarify'])
  const parts = m.parts.filter((p) => !prompts.has(p.type) || (p as { state: string }).state !== 'pending')
  if (!ACTIVE.has(m.status)) return { activity: parts, answer: m.text }
  // Під час роботи текст після останньої дії — це відповідь, що стрімиться.
  let i = parts.length
  while (i > 0 && parts[i - 1]!.type === 'text') i--
  const tail = parts.slice(i) as Extract<Part, { type: 'text' }>[]
  const answer = tail
    .map((p) => p.text)
    .join('\n\n')
    .replace(/^.*MEDIA:\S.*$/gm, '')
  return { activity: parts.slice(0, i), answer }
}

function AssistantMessage({ m }: { m: Message }) {
  const actions = useContext(ActionsContext)
  const active = ACTIVE.has(m.status)
  const { activity, answer } = splitParts(m)
  const pending = m.parts.filter(
    (p): p is Extract<Part, { type: 'approval' | 'clarify' }> =>
      (p.type === 'approval' || p.type === 'clarify') && p.state === 'pending',
  )
  const notices = m.parts.filter((p): p is Extract<Part, { type: 'notice' }> => p.type === 'notice')
  const showActivity = activity.filter((p) => p.type !== 'notice').length > 0 || (active && !answer)
  return (
    <div className="msg msg-assistant">
      {notices.map((n, i) => (
        <div key={i} className="msg-notice">
          <Target size={15} />
          <span>{n.text.replace(/^⊙\s*/, '')}</span>
        </div>
      ))}
      {showActivity && <Activity m={m} parts={activity.filter((p) => p.type !== 'notice')} active={active && !answer} />}
      {pending.map((p) =>
        p.type === 'approval' ? <ApprovalCard key={p.promptId} m={m} p={p} /> : <ClarifyCard key={p.promptId} m={m} p={p} />,
      )}
      {answer && (
        <div className={active ? 'answer is-streaming' : 'answer'}>
          <Markdown text={answer} />
        </div>
      )}
      <Attachments items={m.attachments} side="assistant" />
      {m.status === 'cancelled' && <div className="msg-note">Зупинено</div>}
      {m.error && (
        <div className="msg-error">
          <AlertTriangle size={16} />
          <span>{m.error}</span>
        </div>
      )}
      {!active && (answer || m.attachments.length > 0 || m.error) && (
        <div className="msg-actions">
          {answer && <CopyButton text={answer} />}
          {actions?.enabled && m.turn && (
            <>
              <ActionButton label="Повторити" onClick={() => actions.retry(m)}>
                <RotateCcw size={16} />
              </ActionButton>
              <ActionButton label="Нова гілка звідси" onClick={() => actions.branch(m)}>
                <GitBranch size={16} />
              </ActionButton>
            </>
          )}
          {(m.model || m.usage?.total_tokens) && (
            <span className="msg-meta">
              {m.model}
              {m.model && m.usage?.total_tokens ? ' · ' : ''}
              {m.usage?.total_tokens ? `${Math.round(m.usage.total_tokens / 100) / 10}k токенів` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export const MessageView = memo(function MessageView({ m }: { m: Message }) {
  return m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} />
})
