// Запити Hermes на рішення: дозвіл на команду й уточнювальне питання.
import { CircleCheck, CircleHelp, CircleX, ShieldAlert } from 'lucide-react'
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

export function ClarifyCard({ m, p }: { m: Message; p: Extract<Part, { type: 'clarify' }> }) {
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
