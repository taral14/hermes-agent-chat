import { Bell, BellOff, CalendarClock, ChevronRight, Loader2, Pause, Play, Repeat, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.ts'
import { type Draft, describeSchedule, draftValid, fromDraft, jobStatus, nextRun, relative, toDraft } from '../schedule.ts'
import type { Chat, Job } from '../shared.ts'
import { ScheduleEditor, Switch } from './Jobs.tsx'

/** Відкрити налаштування задачі з будь-якого місця чату (смужка, плашка над результатом, чипи). */
export const openJob = (id: string) => window.dispatchEvent(new CustomEvent('chat:job', { detail: id }))

/** Смужка під заголовком чату задачі: коли запускається і чи на паузі. */
export function JobBar({ chat }: { chat: Chat }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
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

type Form = { name: string; prompt: string; draft: Draft }
const formOf = (j: Job): Form => ({ name: j.name, prompt: j.prompt, draft: toDraft(j.schedule) })

/** Налаштування задачі просто з чату: час, пауза, сповіщення, що робить. */
export function JobSheet({ id, chat, onClose, flash }: { id: string; chat: Chat | null; onClose: () => void; flash: (e: unknown) => void }) {
  const [job, setJob] = useState<Job | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState<Form | null>(null)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api
      .job(id)
      .then((j) => {
        setJob(j)
        setForm(formOf(j))
        setSaved(formOf(j))
      })
      .catch((e) => {
        flash(e)
        onClose()
      })
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [id, flash, onClose])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [form?.prompt])

  const show = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice(''), 2500)
  }
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      flash(e)
    } finally {
      setBusy('')
    }
  }

  const status = job ? jobStatus(job) : 'active'
  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved)
  const invalid = !form ? '' : !form.name.trim() ? 'Дай задачі назву' : !form.prompt.trim() && !job?.no_agent ? 'Опиши, що зробити' : draftValid(form.draft)

  const save = () =>
    run('save', async () => {
      if (!job || !form || !saved || invalid) return
      const patch: Record<string, unknown> = {}
      if (form.name !== saved.name) patch.name = form.name.trim()
      if (form.prompt !== saved.prompt) patch.prompt = form.prompt.trim()
      if (JSON.stringify(form.draft) !== JSON.stringify(saved.draft)) patch.schedule = fromDraft(form.draft)
      const updated = await api.updateJob(job.id, patch)
      setJob(updated)
      setForm(formOf(updated))
      setSaved(formOf(updated))
      show('Збережено')
    })
  const act = (action: 'pause' | 'resume' | 'run') =>
    run(action, async () => {
      if (!job) return
      const updated = await api.jobAction(job.id, action)
      setJob({ ...job, ...updated })
      show(action === 'run' ? 'Запущено — результат прийде в цей чат' : action === 'pause' ? 'Задачу призупинено' : 'Задача знову працює')
    })
  const mute = (muted: boolean) =>
    run('mute', async () => {
      if (chat) await api.patchChat(chat.id, { muted })
    })
  const remove = () =>
    run('delete', async () => {
      if (!job) return
      await api.deleteJob(job.id)
      onClose()
    })

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet job-sheet" role="dialog" aria-modal="true" aria-label="Задача за розкладом" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{job?.name ?? 'Задача'}</h2>
          <button type="button" className="icon-btn" aria-label="Закрити" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {!job || !form ? (
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
                <button type="button" className="btn" disabled={!!busy} onClick={() => void act(status === 'paused' ? 'resume' : 'pause')}>
                  {busy === 'pause' || busy === 'resume' ? <Loader2 size={16} className="spin" /> : status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                  {status === 'paused' ? 'Продовжити' : 'Пауза'}
                </button>
              )}
              <button type="button" className="btn" disabled={!!busy} onClick={() => void act('run')}>
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
                  <button type="button" className="btn btn-danger-solid" disabled={busy === 'delete'} onClick={() => void remove()}>
                    {busy === 'delete' ? <Loader2 size={16} className="spin" /> : 'Видалити'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="job-sheet-delete" onClick={() => setConfirm(true)}>
                <Trash2 size={16} /> Видалити задачу
              </button>
            )}

            {dirty && (
              <div className="job-sheet-save">
                <span className="save-hint">{invalid || 'Є незбережені зміни'}</span>
                <button type="button" className="btn" onClick={() => setForm(saved)}>
                  Скасувати
                </button>
                <button type="button" className="btn btn-primary" disabled={!!invalid || busy === 'save'} onClick={() => void save()}>
                  {busy === 'save' ? <Loader2 size={16} className="spin" /> : 'Зберегти'}
                </button>
              </div>
            )}
            {notice && <div className="toast toast-ok">{notice}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
