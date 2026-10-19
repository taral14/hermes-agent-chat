// Редактор розкладу задачі: щодня, по днях, інтервал, одноразово або cron-вираз.
import { Globe, Repeat } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { DAYS, type Draft, MODES, describeDraft, draftValid, fromDraft } from '../schedule.ts'

type Zone = { timezone: string; configured: boolean }
let zone: Promise<Zone | null> | null = null

/**
 * Час у розкладі Hermes рахує у своєму поясі, а не в поясі браузера. Якщо вони різні або пояс у Hermes
 * не задано (тоді після переходу на літній чи зимовий час задача зсувається на годину) — кажемо про це.
 */
function ZoneNote() {
  const [z, setZ] = useState<Zone | null>(null)
  useEffect(() => {
    let alive = true
    zone ??= api.jobsMeta().catch(() => null)
    void zone.then((v) => alive && setZ(v))
    return () => {
      alive = false
    }
  }, [])
  if (!z) return null
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!z.configured) {
    return (
      <div className="sched-zone">
        <Globe size={14} /> Час за годинником сервера ({z.timezone}). Щоб задачі не зсувались на годину після переходу на літній чи зимовий час,
        задай <code>timezone: {local}</code> у config.yaml Hermes.
      </div>
    )
  }
  if (z.timezone === local) return null
  return (
    <div className="sched-zone">
      <Globe size={14} /> Час за поясом Hermes: {z.timezone}
    </div>
  )
}

export function ScheduleEditor({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const time = 'time' in value ? value.time : '09:00'
  const switchMode = (mode: Draft['mode']) => {
    if (mode === value.mode) return
    if (mode === 'daily' || mode === 'weekdays') onChange({ mode, time })
    else if (mode === 'days') onChange({ mode, time, days: [0] })
    else if (mode === 'interval') onChange({ mode, every: 1, unit: 'h' })
    else if (mode === 'once') {
      const d = new Date(Date.now() + 3600_000)
      d.setMinutes(0, 0, 0)
      const p = (n: number) => String(n).padStart(2, '0')
      onChange({ mode, at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00` })
    } else onChange({ mode: 'cron', expr: fromDraft(value) })
  }
  return (
    <div className="sched">
      <div className="seg-scroll">
        <div className="seg seg-modes">
          {MODES.map((m) => (
            <button key={m.mode} type="button" aria-pressed={value.mode === m.mode} className={value.mode === m.mode ? 'is-on' : ''} onClick={() => switchMode(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {value.mode === 'days' && (
        <div className="day-row">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={value.days.includes(i)} className={`day ${value.days.includes(i) ? 'is-on' : ''}`}
              onClick={() =>
                onChange({ ...value, days: value.days.includes(i) ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {'time' in value && (
        <label className="field-inline">
          <span>Час</span>
          <input type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
        </label>
      )}
      {value.mode === 'interval' && (
        <div className="field-inline">
          <span>Кожні</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={Number.isFinite(value.every) ? value.every : ''}
            onChange={(e) => onChange({ ...value, every: Number(e.target.value) })}
          />
          <div className="seg seg-small">
            {(
              [
                ['m', 'хв'],
                ['h', 'год'],
                ['d', 'дн'],
              ] as const
            ).map(([u, l]) => (
              <button key={u} type="button" aria-pressed={value.unit === u} className={value.unit === u ? 'is-on' : ''} onClick={() => onChange({ ...value, unit: u })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      {value.mode === 'once' && (
        <label className="field-inline">
          <span>Коли</span>
          <input type="datetime-local" value={value.at} onChange={(e) => onChange({ ...value, at: e.target.value })} />
        </label>
      )}
      {value.mode === 'cron' && (
        <label className="field-inline">
          <span>Вираз</span>
          <input className="mono" value={value.expr} placeholder="0 9 * * 1-5" onChange={(e) => onChange({ ...value, expr: e.target.value })} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
      )}
      <div className={`sched-preview ${draftValid(value) ? 'is-bad' : ''}`}>
        <Repeat size={14} /> {describeDraft(value)}
      </div>
      {value.mode !== 'interval' && value.mode !== 'once' && <ZoneNote />}
    </div>
  )
}
