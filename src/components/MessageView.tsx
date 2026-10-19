// Повідомлення в розмові: питання користувача й відповідь Hermes з ходом роботи, запитами й вкладеннями.
import { AlertTriangle, GitBranch, Pencil, RotateCcw, Target, Loader2 } from 'lucide-react'
import { createContext, memo, useContext, useRef, useState, type ReactNode } from 'react'
import { useAutosize } from '../hooks/useAutosize.ts'
import { usePrefs } from '../prefs.ts'
import type { Message, Part } from '../shared.ts'
import { AnswerLinks, LinkPreviews, LinkText } from './Links.tsx'
import { CopyButton, Markdown } from './Markdown.tsx'
import { Activity } from './message/Activity.tsx'
import { Attachments } from './message/Attachments.tsx'
import { DeliveredBadge, JobChips } from './message/JobChips.tsx'
import { ApprovalCard, ClarifyCard } from './message/Prompts.tsx'
import { ErrorBoundary, MessageFallback } from './ui/ErrorBoundary.tsx'

const ACTIVE = new Set(['queued', 'running', 'stopping'])

// ---------- Дії над повідомленнями ----------

/**
 * Дії з повідомленнями. Значення контексту має бути стабільним (міняється лише enabled), інакше кожен токен
 * відповіді перемальовує всі повідомлення розмови в обхід memo.
 */
export type MessageActions = {
  /** Чат можна продовжувати, і Hermes зараз не працює. */
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

/** Цитата з відповіді Hermes на початку повідомлення («> …» рядки) окремо від самого питання. */
function splitQuote(text: string): { quote: string; rest: string } {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && /^>\s?/.test(lines[i]!)) i++
  if (!i) return { quote: '', rest: text }
  return {
    quote: lines
      .slice(0, i)
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim(),
    rest: lines.slice(i).join('\n').trim(),
  }
}

function UserMessage({ m }: { m: Message }) {
  const actions = useContext(ActionsContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useAutosize(box, editing && draft, 320)
  const canEdit = Boolean(actions?.enabled && m.turn && m.text && !m.text.startsWith('/'))
  const { quote, rest } = splitQuote(m.text)

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
      {m.text && (
        <div className={`bubble ${m.text.startsWith('/') ? 'is-command' : ''}`}>
          {m.text.startsWith('/') ? (
            m.text
          ) : (
            <>
              {quote && <div className="bubble-quote">{quote}</div>}
              {rest && <LinkText text={rest} />}
            </>
          )}
        </div>
      )}
      {rest && !m.text.startsWith('/') && <LinkPreviews text={rest} />}
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

// ---------- Час між повідомленнями ----------

const DAY = 86400_000
const dayStart = (t: number) => new Date(new Date(t).toDateString()).getTime()
const timeFmt = new Intl.DateTimeFormat('uk', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('uk', { weekday: 'short', day: 'numeric', month: 'short' })

/** Розділювач потрібен між повідомленнями різних днів або з перервою понад 3 години. */
export function needsTimeSeparator(prev: Message | undefined, m: Message): boolean {
  if (!prev) return dayStart(m.createdAt) < dayStart(Date.now())
  return dayStart(prev.createdAt) !== dayStart(m.createdAt) || m.createdAt - prev.createdAt > 3 * 3600_000
}

export function TimeSeparator({ at }: { at: number }) {
  const today = dayStart(Date.now())
  const day = dayStart(at)
  const label = day === today ? 'Сьогодні' : day === today - DAY ? 'Учора' : dateFmt.format(at)
  return (
    <div className="time-sep">
      <b>{label}</b> о {timeFmt.format(at)}
    </div>
  )
}

function AssistantMessage({ m }: { m: Message }) {
  const actions = useContext(ActionsContext)
  const { showMeta } = usePrefs()
  const active = ACTIVE.has(m.status)
  const { activity, answer } = splitParts(m)
  const pending = m.parts.filter(
    (p): p is Extract<Part, { type: 'approval' | 'clarify' }> =>
      (p.type === 'approval' || p.type === 'clarify') && p.state === 'pending',
  )
  const notices = m.parts.filter((p): p is Extract<Part, { type: 'notice' }> => p.type === 'notice')
  const delivered = m.parts.find((p): p is Extract<Part, { type: 'delivered' }> => p.type === 'delivered')
  const steps = activity.filter((p) => p.type !== 'notice' && p.type !== 'delivered')
  const showActivity = steps.length > 0 || (active && !answer)
  return (
    <div className="msg msg-assistant">
      {notices.map((n, i) => (
        <div key={i} className="msg-notice">
          <Target size={15} />
          <span>{n.text.replace(/^⊙\s*/, '')}</span>
        </div>
      ))}
      {delivered && <DeliveredBadge d={delivered} />}
      {showActivity && <Activity m={m} parts={steps} active={active && !answer} />}
      {pending.map((p) =>
        p.type === 'approval' ? <ApprovalCard key={p.promptId} m={m} p={p} /> : <ClarifyCard key={p.promptId} m={m} p={p} />,
      )}
      {answer && (
        <div className={active ? 'answer is-streaming' : 'answer'}>
          <Markdown text={answer} />
        </div>
      )}
      {!active && <JobChips parts={m.parts} />}
      {!active && answer && <AnswerLinks text={answer} />}
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
          {showMeta && (m.model || m.usage?.total_tokens) && (
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
  return <ErrorBoundary fallback={() => <MessageFallback />}>{m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} />}</ErrorBoundary>
})
