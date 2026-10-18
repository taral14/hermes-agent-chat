import { CheckCircle2, Loader2, Pause, Play, Repeat, Target, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api.ts'
import type { Chat } from '../shared.ts'

const LIVE = new Set(['active', 'paused', 'running', 'pending', 'waiting'])

/** Панель автоматизацій чату над полем вводу: мета (/goal) з кроками й керуванням, петля, серцебиття. */
export function GoalBar({ chat, flash }: { chat: Chat; flash: (e: unknown) => void }) {
  const [busy, setBusy] = useState('')
  const goal = chat.control?.goal
  const loop = chat.control?.loop
  const heartbeat = chat.control?.heartbeat
  const goalLive = goal && LIVE.has(goal.status)
  if (!goalLive && !loop && !heartbeat) return null

  const run = async (key: string, command: string) => {
    setBusy(key)
    try {
      await api.control(chat.id, command)
    } catch (e) {
      flash(e)
    } finally {
      setBusy('')
    }
  }
  const paused = goal?.status === 'paused'

  return (
    <div className="goal-bar">
      {goalLive && goal && (
        <div className={`goal ${paused ? 'is-paused' : ''}`}>
          <span className="goal-icon">{paused ? <Pause size={15} /> : <Target size={15} />}</span>
          <span className="goal-text">
            <span className="goal-label">{paused ? 'Мета на паузі' : 'Мета'}</span>
            <span className="goal-title">{goal.title}</span>
          </span>
          {typeof goal.turns_used === 'number' && goal.max_turns ? (
            <span className="goal-turns" title="Кроків використано">
              {goal.turns_used}/{goal.max_turns}
            </span>
          ) : null}
          <button
            type="button"
            className="icon-btn round"
            title={paused ? 'Продовжити' : 'Пауза'}
            aria-label={paused ? 'Продовжити' : 'Пауза'}
            disabled={!!busy}
            onClick={() => void run('toggle', paused ? '/goal resume' : '/goal pause')}
          >
            {busy === 'toggle' ? <Loader2 size={16} className="spin" /> : paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button type="button" className="icon-btn round" title="Зняти мету" aria-label="Зняти мету" disabled={!!busy} onClick={() => void run('clear', '/goal clear')}>
            {busy === 'clear' ? <Loader2 size={16} className="spin" /> : <X size={16} />}
          </button>
        </div>
      )}
      {(loop || heartbeat) && (
        <div className="goal goal-small">
          <span className="goal-icon">{loop ? <Repeat size={15} /> : <CheckCircle2 size={15} />}</span>
          <span className="goal-text">
            <span className="goal-title">{loop ? 'У чаті працює петля (/loop)' : 'Увімкнено серцебиття (/heartbeat)'}</span>
          </span>
          <button
            type="button"
            className="icon-btn round"
            title="Вимкнути"
            aria-label="Вимкнути"
            disabled={!!busy}
            onClick={() => void run('off', loop ? '/loop clear' : '/heartbeat clear')}
          >
            {busy === 'off' ? <Loader2 size={16} className="spin" /> : <X size={16} />}
          </button>
        </div>
      )}
    </div>
  )
}
