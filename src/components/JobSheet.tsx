import { Bell, BellOff, CalendarClock, ChevronRight, Loader2, Pause, Play, Repeat, Trash2, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api.ts'
import { emit } from '../bus.ts'
import { useAutosize } from '../hooks/useAutosize.ts'
import { useJobForm } from '../hooks/useJobForm.ts'
import { useTick } from '../hooks/useTick.ts'
import { describeSchedule, jobStatus, nextRun, relative } from '../schedule.ts'
import type { Chat } from '../shared.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'
import { Sheet } from './ui/Sheet.tsx'
import { Switch } from './ui/Switch.tsx'

/** Відкрити налаштування задачі з будь-якого місця чату (смужка, плашка над результатом, чипи). */
export const openJob = (id: string) => void emit('job', id)

/** Смужка під заголовком чату задачі: коли запускається і чи на паузі. */
export function JobBar({ chat }: { chat: Chat }) {
  const now = useTick()
  if (!chat.jobs?.length) return null
  return (
    <div className="job-bar">
      {chat.jobs.map((j) => (
        <button key={j.id} type="button" className={`job-bar-item ${j.enabled ? '' : 'is-paused'}`} onClick={() => openJob(j.id)} title={j.name}>
          {j.spec?.kind === 'once' ? <CalendarClock size={16} /> : <Repeat size={16} />}
          <span className="job-bar-text">
            <b>{j.spec ? describeSchedule(j.spec) : j.schedule || 'За розкладом'}</b>
            {j.enabled ? (j.spec?.kind === 'once' ? '' : ` · далі ${nextRun(j.nextRunAt, now)}`) : ' · на паузі'}
          </span>
          {chat.muted && <BellOff size={15} className="job-bar-muted" aria-label="Без сповіщень" />}
          <ChevronRight size={16} className="job-bar-go" />
        </button>
      ))}
    </div>
  )
}

/** Налаштування задачі просто з чату: час, пауза, сповіщення, що робить. */
export function JobSheet({ id, chat, onClose, flash }: { id: string; chat: Chat | null; onClose: () => void; flash: (e: unknown) => void }) {
  const { job, form, setForm, reset, dirty, invalid, busy, notice, show, run, save, act, remove } = useJobForm(id, { flash, onMissing: onClose })
  const [confirm, setConfirm] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useAutosize(area, form.prompt, 240)

  /** Закрити; незбережені зміни — спершу спитати. */
  const close = () => (dirty ? setConfirmClose(true) : onClose())
  const status = job ? jobStatus(job) : 'active'

  const onAct = async (action: 'pause' | 'resume' | 'run') => {
    if (await act(action)) show(action === 'run' ? 'Запущено — результат прийде в цей чат' : action === 'pause' ? 'Задачу призупинено' : 'Задача знову працює')
  }
  const mute = (muted: boolean) => run('mute', async () => chat && api.patchChat(chat.id, { muted }))
  const onRemove = async () => {
    if (await remove()) onClose()
  }

  return (
    <Sheet title={job?.name ?? 'Задача'} label="Задача за розкладом" className="job-sheet" onClose={close}>
      {!job ? (
        <div className="jobs-loading">
          <Loader2 size={22} className="spin" />
        </div>
      ) : (
        <>
          <p className="sheet-lead">
            {status === 'paused'
              ? 'На паузі — не запускається, поки не продовжиш.'
              : status === 'done'
                ? `Виконано ${relative(job.last_run_at, Date.now())}.`
                : `Наступний запуск ${nextRun(job.next_run_at)}.`}
            {job.last_run_at && status !== 'done' ? ` Востаннє ${relative(job.last_run_at)}.` : ''}
          </p>

          <div className="job-sheet-actions">
            {status !== 'done' && (
              <button type="button" className="btn" disabled={!!busy} onClick={() => void onAct(status === 'paused' ? 'resume' : 'pause')}>
                {busy === 'pause' || busy === 'resume' ? <Loader2 size={16} className="spin" /> : status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                {status === 'paused' ? 'Продовжити' : 'Пауза'}
              </button>
            )}
            <button type="button" className="btn" disabled={!!busy} onClick={() => void onAct('run')}>
              {busy === 'run' ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
              Запустити
            </button>
          </div>

          {chat && (
            <div className="job-sheet-row">
              {chat.muted ? <BellOff size={18} /> : <Bell size={18} />}
              <span>
                <b>Сповіщення</b>
                <small>{chat.muted ? 'Результати тихо з’являються в чаті' : 'Пуш, коли приходить результат'}</small>
              </span>
              <Switch on={!chat.muted} busy={busy === 'mute'} label="Сповіщення" onChange={(v) => void mute(!v)} />
            </div>
          )}

          <div className="form-card">
            <span className="field-label">Коли</span>
            <ScheduleEditor value={form.draft} onChange={(draft) => setForm({ ...form, draft })} />
          </div>

          <div className="form-card">
            <label className="field">
              <span className="field-label">Назва</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">{job.no_agent ? 'Опис' : 'Що робить'}</span>
              <textarea ref={area} rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </label>
            {job.repeat.completed > 0 && <span className="field-hint">Виконано разів: {job.repeat.completed}</span>}
          </div>

          {confirm ? (
            <div className="confirm">
              <span>Видалити задачу «{job.name}»? Чат лишиться.</span>
              <div>
                <button type="button" className="btn" onClick={() => setConfirm(false)}>
                  Скасувати
                </button>
                <button type="button" className="btn btn-danger-solid" disabled={busy === 'delete'} onClick={() => void onRemove()}>
                  {busy === 'delete' ? <Loader2 size={16} className="spin" /> : 'Видалити'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="job-sheet-delete" onClick={() => setConfirm(true)}>
              <Trash2 size={16} /> Видалити задачу
            </button>
          )}

          {confirmClose ? (
            <div className="job-sheet-save is-warn">
              <span className="save-hint">Зміни не збережено. Закрити без збереження?</span>
              <button type="button" className="btn" onClick={() => setConfirmClose(false)}>
                Лишитись
              </button>
              <button type="button" className="btn btn-danger-solid" onClick={onClose}>
                Не зберігати
              </button>
            </div>
          ) : (
            dirty && (
              <div className="job-sheet-save">
                <span className="save-hint">{invalid || 'Є незбережені зміни'}</span>
                <button type="button" className="btn" onClick={reset}>
                  Скасувати
                </button>
                <button type="button" className="btn btn-primary" disabled={!!invalid || busy === 'save'} onClick={() => void save()}>
                  {busy === 'save' ? <Loader2 size={16} className="spin" /> : 'Зберегти'}
                </button>
              </div>
            )
          )}
          {notice && <div className="toast toast-ok">{notice}</div>}
        </>
      )}
    </Sheet>
  )
}
