// Запити Hermes на рішення: дозвіл на команду й уточнювальне питання.
import { Check, CircleCheck, CircleHelp, CircleX, Loader2, PenLine, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api.ts'
import type { Message, Part } from '../../shared.ts'
import { Markdown } from '../Markdown.tsx'

const CHOICE_LABEL: Record<string, string> = {
  once: 'Дозволити',
  session: 'Дозволити в цьому чаті',
  always: 'Дозволяти завжди',
  deny: 'Відхилити',
}

export function ApprovalCard({ m, p }: { m: Message; p: Extract<Part, { type: 'approval' }> }) {
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

/** Hermes позначає перший варіант як рекомендований підписом «(Recommended)»: показуємо його окремою позначкою. */
const RECOMMENDED = /\s*\(recommended\)\s*$/i
const choiceLabel = (c: string) => c.replace(RECOMMENDED, '').trim()

/** Відповідь на питання з кількома виборами приходить JSON-масивом: показуємо списком. */
export function clarifyAnswerText(answer: string): string {
  try {
    const v: unknown = JSON.parse(answer)
    if (Array.isArray(v)) return v.map((x) => choiceLabel(String(x))).join(', ')
  } catch {
    /* звичайний текст */
  }
  return choiceLabel(answer)
}

/** Відповісти на питання Hermes. Своя відповідь пишеться в полі вводу (див. App: поки питання чекає, поле відповідає на нього). */
export async function answerClarify(m: Message, p: Extract<Part, { type: 'clarify' }>, value: string) {
  await api.clarify(m.id, p.promptId, p.generation, value)
}

export function ClarifyCard({ m, p }: { m: Message; p: Extract<Part, { type: 'clarify' }> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const answer = async (value: string, key = value) => {
    setBusy(key)
    setErr('')
    try {
      await answerClarify(m, p, value)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }
  if (p.state !== 'pending') {
    return (
      <div className="prompt-done">
        <CircleHelp size={15} />
        <span>
          {p.question}
          {p.answer ? <> — <b>{clarifyAnswerText(p.answer)}</b></> : ' (без відповіді)'}
        </span>
      </div>
    )
  }
  const toggle = (c: string) => setPicked((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))
  return (
    <div className="prompt-card prompt-clarify">
      <div className="prompt-question">
        <Markdown text={p.question} />
      </div>
      {p.choices.length > 0 && (
        <div className="clarify-options">
          {p.choices.map((c, i) => {
            const label = choiceLabel(c)
            const on = picked.includes(c)
            return (
              <button
                key={c}
                type="button"
                className={`clarify-option ${on ? 'is-on' : ''}`}
                disabled={busy !== null}
                aria-pressed={p.multi ? on : undefined}
                onClick={() => (p.multi ? toggle(c) : void answer(c))}
              >
                <span className={`clarify-mark ${p.multi ? 'is-box' : ''}`}>{p.multi ? on && <Check size={14} strokeWidth={3} /> : i + 1}</span>
                <span className="clarify-label">{label}</span>
                {label !== c.trim() && <span className="clarify-rec">Рекомендую</span>}
                {busy === c && <Loader2 size={16} className="spin" />}
              </button>
            )
          })}
        </div>
      )}
      {p.multi && (
        <button
          type="button"
          className="btn btn-primary clarify-submit"
          disabled={busy !== null || !picked.length}
          onClick={() => void answer(JSON.stringify(picked.map(choiceLabel)), 'multi')}
        >
          {busy === 'multi' && <Loader2 size={16} className="spin" />}
          Відповісти
        </button>
      )}
      <div className="clarify-hint">
        <PenLine size={14} />
        {p.choices.length ? 'Або напиши свій варіант у полі внизу' : 'Напиши відповідь у полі внизу'}
      </div>
      {err && <div className="prompt-err">{err}</div>}
    </div>
  )
}
