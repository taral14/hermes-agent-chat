// Задачі за розкладом у відповіді: плашка «Назва задачі ›» над результатом і чипи змін, зроблених Hermes.
import { AlarmClock, ChevronRight, Send } from 'lucide-react'
import { emit } from '../../bus.ts'
import type { Part } from '../../shared.ts'

/** Відкрити задачу поверх чату; cmd/ctrl-клік і сторінка без обробника — звичайне посилання. */
function openJob(e: React.MouseEvent, id: string | undefined, href: string) {
  if (e.metaKey || e.ctrlKey) return
  if (id ? emit('job', id) : emit('navigate', href)) e.preventDefault()
}

/** Заголовок над повідомленням, яке Hermes надіслав сам: як у ChatGPT, «Назва задачі ›» веде до задачі. */
export function DeliveredBadge({ d }: { d: Extract<Part, { type: 'delivered' }> }) {
  if (d.source !== 'cron') {
    return (
      <div className="msg-delivered">
        <Send size={14} />
        <span>Hermes написав сам</span>
      </div>
    )
  }
  const href = d.jobId ? `/jobs/${d.jobId}` : '/jobs'
  return (
    <a
      className="msg-delivered is-job"
      href={href}
      onClick={(e) => openJob(e, d.jobId, href)}
    >
      <span>{d.job || 'Задача за розкладом'}</span>
      <ChevronRight size={16} />
    </a>
  )
}

const JOB_ACTIONS: Record<string, string> = {
  create: 'Задача',
  update: 'Змінено',
  pause: 'На паузі',
  resume: 'Відновлено',
  remove: 'Видалено',
  run: 'Запущено',
}

/** Що Hermes зробив із задачами за розкладом у цій відповіді (інструмент cronjob_manage). */
function jobActions(parts: Part[]): { action: string; id: string; name: string }[] {
  const out = new Map<string, { action: string; id: string; name: string }>()
  for (const p of parts) {
    if (p.type !== 'tool' || p.tool !== 'cronjob_manage' || p.status !== 'done') continue
    const raw = `${p.preview}\n${p.result ?? ''}`
    const action = /\bremoved_job\b/.test(raw) ? 'remove' : (/\b(create|update|pause|resume|remove|run)\b/.exec(p.preview)?.[1] ?? (/"job_id"/.test(raw) ? 'create' : ''))
    if (!action) continue
    const id = /"(?:job_id|id)"\s*:\s*"([\w-]{4,})"/.exec(raw)?.[1]
    if (!id) continue
    let name = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? ''
    try {
      name = JSON.parse(`"${name}"`) as string
    } catch {
      /* лишаємо як є */
    }
    out.set(id, { action, id, name: name || 'Задача за розкладом' })
  }
  return [...out.values()]
}

export function JobChips({ parts }: { parts: Part[] }) {
  const items = jobActions(parts)
  if (!items.length) return null
  return (
    <div className="job-chips">
      {items.map((j) => {
        const body = (
          <>
            <AlarmClock size={16} />
            <span className="job-chip-kind">{JOB_ACTIONS[j.action] ?? 'Задача'}</span>
            <span className="job-chip-dot">·</span>
            <span className="job-chip-name">{j.name}</span>
          </>
        )
        return j.action === 'remove' ? (
          <span key={j.id} className="job-chip is-removed">
            {body}
          </span>
        ) : (
          <a
            key={j.id}
            className="job-chip"
            href={`/jobs/${j.id}`}
            onClick={(e) => openJob(e, j.id, `/jobs/${j.id}`)}
          >
            {body}
          </a>
        )
      })}
    </div>
  )
}
