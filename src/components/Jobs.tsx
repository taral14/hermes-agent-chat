import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileCode2,
  Loader2,
  Menu,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  Send,
  Trash2,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api.ts'
import {
  DAYS,
  type Draft,
  MODES,
  STATUS_LABEL,
  deliverLabel,
  describeDraft,
  describeSchedule,
  draftValid,
  duration,
  fromDraft,
  jobStatus,
  nextRun,
  relative,
  toDraft,
} from '../schedule.ts'
import type { Job, JobRun } from '../shared.ts'
import { Markdown } from './Markdown.tsx'

export type JobsRoute = { kind: 'list' } | { kind: 'job'; id: string } | { kind: 'new' }

type Props = {
  route: JobsRoute
  go: (r: JobsRoute | null) => void
  sidebarOpen: boolean
  openSidebar: () => void
  flash: (e: unknown) => void
}

function useTick(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function Switch({ on, busy, onChange, label }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'is-on' : ''} ${busy ? 'is-busy' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (!busy) onChange(!on)
      }}
    >
      <span className="switch-knob" />
    </button>
  )
}

function StatusPill({ job }: { job: Job }) {
  const s = jobStatus(job)
  return <span className={`pill pill-${s}`}>{STATUS_LABEL[s]}</span>
}

function TopBar({ title, back, right, sidebarOpen, openSidebar }: {
  title: string
  back?: () => void
  right?: ReactNode
  sidebarOpen: boolean
  openSidebar: () => void
}) {
  return (
    <header className="topbar jobs-topbar">
      <div className="topbar-left">
        {back ? (
          <button type="button" className="icon-btn" onClick={back} aria-label="Назад">
            <ChevronLeft size={22} />
          </button>
        ) : (
          !sidebarOpen && (
            <button type="button" className="icon-btn" onClick={openSidebar} aria-label="Показати панель">
              <span className="only-wide">
                <PanelLeftOpen size={20} />
              </span>
              <span className="only-narrow">
                <Menu size={20} />
              </span>
            </button>
          )
        )}
        <span className="jobs-topbar-title">{title}</span>
      </div>
      {right}
    </header>
  )
}

// ---------- Список ----------

function JobCard({ job, now, onOpen, onToggle }: { job: Job; now: number; onOpen: () => void; onToggle: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const status = jobStatus(job)
  const toggleable = status !== 'done'
  const isOn = status !== 'paused' && status !== 'done'
  return (
    <div className={`job-card is-${status}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="job-card-head">
        <div className="job-card-title">
          {job.no_agent && (
            <span className="job-tag" title="Скрипт без агента">
              <FileCode2 size={12} /> скрипт
            </span>
          )}
          <span className="job-name">{job.name}</span>
        </div>
        {toggleable && (
          <Switch
            on={isOn}
            busy={busy}
            label={isOn ? 'Поставити на паузу' : 'Продовжити'}
            onChange={async (v) => {
              setBusy(true)
              await onToggle(v)
              setBusy(false)
            }}
          />
        )}
      </div>
      <div className="job-when">
        {job.schedule.kind === 'once' ? <CalendarClock size={15} /> : <Repeat size={15} />}
        <span>{describeSchedule(job.schedule)}</span>
      </div>
      <div className="job-meta">
        {status === 'done' ? (
          <span>Виконано {relative(job.last_run_at, now)}</span>
        ) : status === 'paused' ? (
          <span>На паузі</span>
        ) : (
          <span>
            <Clock size={13} /> {nextRun(job.next_run_at, now)}
          </span>
        )}
        {job.last_run_at && status !== 'done' && (
          <span className={`job-last ${status === 'error' ? 'is-error' : ''}`}>
            {status === 'error' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {relative(job.last_run_at, now)}
          </span>
        )}
      </div>
    </div>
  )
}

function JobsList({ go, sidebarOpen, openSidebar, flash }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const now = useTick()
  const load = useCallback(() => api.jobs().then(setJobs).catch(flash), [flash])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const groups = useMemo(() => {
    const by = { active: [] as Job[], paused: [] as Job[], done: [] as Job[] }
    for (const j of jobs ?? []) {
      const s = jobStatus(j)
      by[s === 'paused' ? 'paused' : s === 'done' ? 'done' : 'active'].push(j)
    }
    const next = (j: Job) => (j.next_run_at ? new Date(j.next_run_at).getTime() : Infinity)
    by.active.sort((a, b) => next(a) - next(b))
    return by
  }, [jobs])

  const toggle = async (job: Job, on: boolean) => {
    try {
      const updated = await api.jobAction(job.id, on ? 'resume' : 'pause')
      setJobs((list) => list?.map((j) => (j.id === job.id ? { ...j, ...updated } : j)) ?? null)
    } catch (e) {
      flash(e)
    }
  }

  const soonest = groups.active.find((j) => j.next_run_at)
  return (
    <>
      <TopBar
        title="Розклад"
        sidebarOpen={sidebarOpen}
        openSidebar={openSidebar}
        right={
          <button type="button" className="icon-btn only-wide" aria-label="Нова задача" title="Нова задача" onClick={() => go({ kind: 'new' })}>
            <Plus size={22} />
          </button>
        }
      />
      <div className="jobs-scroll">
        <div className="jobs-inner">
          <div className="jobs-hero">
            <h1>Розклад</h1>
            <p>
              {jobs == null
                ? 'Завантажую задачі Hermes…'
                : jobs.length === 0
                  ? 'Задачі, які Hermes виконує сам за розкладом.'
                  : `${groups.active.length} активних${groups.paused.length ? ` · ${groups.paused.length} на паузі` : ''}${soonest ? ` · наступна ${nextRun(soonest.next_run_at, now)}` : ''}`}
            </p>
          </div>
          {jobs == null && (
            <div className="jobs-loading">
              <Loader2 size={22} className="spin" />
            </div>
          )}
          {jobs?.length === 0 && (
            <div className="jobs-empty">
              <div className="jobs-empty-icon">
                <CalendarClock size={30} />
              </div>
              <p>Ще немає жодної задачі. Попроси Hermes нагадувати, перевіряти чи збирати щось регулярно.</p>
              <button type="button" className="btn btn-primary" onClick={() => go({ kind: 'new' })}>
                <Plus size={16} /> Нова задача
              </button>
            </div>
          )}
          {(
            [
              ['active', 'Активні'],
              ['paused', 'На паузі'],
              ['done', 'Виконані'],
            ] as const
          ).map(([key, label]) =>
            groups[key].length ? (
              <section key={key} className="jobs-section">
                <h2>{label}</h2>
                <div className="jobs-grid">
                  {groups[key].map((j) => (
                    <JobCard key={j.id} job={j} now={now} onOpen={() => go({ kind: 'job', id: j.id })} onToggle={(on) => toggle(j, on)} />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      </div>
      <button type="button" className="fab only-narrow" onClick={() => go({ kind: 'new' })} aria-label="Нова задача">
        <Plus size={24} />
      </button>
    </>
  )
}

// ---------- Редактор розкладу ----------

function ScheduleEditor({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
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
            <button key={m.mode} type="button" className={value.mode === m.mode ? 'is-on' : ''} onClick={() => switchMode(m.mode)}>
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
              className={`day ${value.days.includes(i) ? 'is-on' : ''}`}
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
              <button key={u} type="button" className={value.unit === u ? 'is-on' : ''} onClick={() => onChange({ ...value, unit: u })}>
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
    </div>
  )
}

// ---------- Задача ----------

function RunRow({ run, now }: { run: JobRun; now: number }) {
  const [open, setOpen] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ok = !run.endReason || /complete|ok|success/i.test(run.endReason)
  useEffect(() => {
    if (!open || output != null) return
    api
      .runOutput(run.sessionId)
      .then((r) => setOutput(r.output))
      .catch((e: Error) => setError(e.message))
  }, [open, output, run.sessionId])
  return (
    <div className={`run ${open ? 'is-open' : ''}`}>
      <button type="button" className="run-head" onClick={() => setOpen((o) => !o)}>
        <span className={`run-dot ${run.endedAt ? (ok ? 'is-ok' : 'is-bad') : 'is-live'}`} />
        <span className="run-when">{relative(run.startedAt, now)}</span>
        <span className="run-meta">
          {run.endedAt ? duration(run.endedAt - run.startedAt) : 'виконується'}
          {run.tools ? ` · ${run.tools} ${run.tools === 1 ? 'дія' : run.tools < 5 ? 'дії' : 'дій'}` : ''}
        </span>
        <ChevronDown size={16} className="run-chevron" />
      </button>
      {open && (
        <div className="run-body">
          {error ? (
            <div className="msg-error">{error}</div>
          ) : output == null ? (
            <Loader2 size={18} className="spin" />
          ) : output ? (
            <Markdown text={output} />
          ) : (
            <span className="muted">Без текстового результату.</span>
          )}
        </div>
      )}
    </div>
  )
}

type Form = { name: string; prompt: string; draft: Draft; deliver: string; repeat: number | null }

function formOf(job: Job | null): Form {
  return {
    name: job?.name ?? '',
    prompt: job?.prompt ?? '',
    draft: toDraft(job?.schedule),
    deliver: job?.deliver ?? 'telegram',
    repeat: job?.repeat.times ?? null,
  }
}

function JobPage({ route, go, sidebarOpen, openSidebar, flash }: Props) {
  const id = route.kind === 'job' ? route.id : null
  const [job, setJob] = useState<Job | null>(null)
  const [form, setForm] = useState<Form>(() => formOf(null))
  const [saved, setSaved] = useState<Form>(() => formOf(null))
  const [runs, setRuns] = useState<JobRun[] | null>(null)
  const [busy, setBusy] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const now = useTick()

  useEffect(() => {
    if (!id) return
    api
      .job(id)
      .then((j) => {
        setJob(j)
        setForm(formOf(j))
        setSaved(formOf(j))
      })
      .catch((e) => {
        flash(e)
        go({ kind: 'list' })
      })
    api.jobRuns(id).then(setRuns).catch(() => setRuns([]))
  }, [id, flash, go])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [form.prompt])

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const invalid = !form.name.trim() ? 'Дай задачі назву' : !form.prompt.trim() && !job?.no_agent ? 'Опиши, що зробити' : draftValid(form.draft)
  const status = job ? jobStatus(job) : 'active'

  const save = async () => {
    if (invalid) return
    setBusy('save')
    try {
      const body = { name: form.name.trim(), prompt: form.prompt.trim(), schedule: fromDraft(form.draft), deliver: form.deliver, repeat: form.repeat }
      if (!job) {
        const created = await api.createJob({ ...body, repeat: body.repeat ?? undefined })
        go({ kind: 'job', id: created.id })
        return
      }
      const patch: Record<string, unknown> = {}
      if (form.name !== saved.name) patch.name = body.name
      if (form.prompt !== saved.prompt) patch.prompt = body.prompt
      if (JSON.stringify(form.draft) !== JSON.stringify(saved.draft)) patch.schedule = body.schedule
      if (form.deliver !== saved.deliver) patch.deliver = body.deliver
      if (form.repeat !== saved.repeat) patch.repeat = body.repeat
      const updated = await api.updateJob(job.id, patch)
      setJob(updated)
      setForm(formOf(updated))
      setSaved(formOf(updated))
      setNotice('Збережено')
      setTimeout(() => setNotice(''), 2000)
    } catch (e) {
      flash(e)
    } finally {
      setBusy('')
    }
  }

  const act = async (action: 'pause' | 'resume' | 'run') => {
    if (!job) return
    setBusy(action)
    try {
      const updated = await api.jobAction(job.id, action)
      setJob({ ...job, ...updated })
      if (action === 'run') {
        setNotice('Запущено — результат прийде туди, куди надсилається задача')
        setTimeout(() => setNotice(''), 4000)
        setTimeout(() => api.jobRuns(job.id).then(setRuns).catch(() => {}), 4000)
      }
    } catch (e) {
      flash(e)
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!job) return
    setBusy('delete')
    try {
      await api.deleteJob(job.id)
      go({ kind: 'list' })
    } catch (e) {
      flash(e)
      setBusy('')
    }
  }

  if (id && !job) {
    return (
      <>
        <TopBar title="Задача" back={() => go({ kind: 'list' })} sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
        <div className="jobs-loading">
          <Loader2 size={22} className="spin" />
        </div>
      </>
    )
  }

  const deliverOptions = [
    { v: 'telegram', label: 'Telegram' },
    ...(job?.origin?.platform && !['telegram', 'api_server', 'local'].includes(job.origin.platform) ? [{ v: 'origin', label: deliverLabel({ deliver: 'origin', origin: job.origin }) }] : []),
    { v: 'local', label: 'Лише зберігати' },
  ]
  if (!deliverOptions.some((o) => o.v === form.deliver)) deliverOptions.unshift({ v: form.deliver, label: deliverLabel({ deliver: form.deliver, origin: job?.origin ?? null }) })

  return (
    <>
      <TopBar title={job ? 'Задача' : 'Нова задача'} back={() => go({ kind: 'list' })} sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
      <div className="jobs-scroll">
        <div className="jobs-inner job-page">
          {job && (
            <div className="job-hero">
              <div className="job-hero-row">
                <StatusPill job={job} />
                {job.no_agent && (
                  <span className="job-tag">
                    <FileCode2 size={12} /> скрипт {job.script}
                  </span>
                )}
              </div>
              <h1>{job.name}</h1>
              <div className="job-hero-next">
                {status === 'paused' ? (
                  'На паузі'
                ) : status === 'done' ? (
                  `Виконано ${relative(job.last_run_at, now)}`
                ) : (
                  <>
                    Наступний запуск <b>{nextRun(job.next_run_at, now)}</b>
                  </>
                )}
              </div>
              <div className="job-actions">
                <button type="button" className="job-action" disabled={!!busy} onClick={() => void act('run')}>
                  <span>{busy === 'run' ? <Loader2 size={20} className="spin" /> : <Zap size={20} />}</span>
                  Запустити
                </button>
                {status !== 'done' && (
                  <button type="button" className="job-action" disabled={!!busy} onClick={() => void act(status === 'paused' ? 'resume' : 'pause')}>
                    <span>{status === 'paused' ? <Play size={20} /> : <Pause size={20} />}</span>
                    {status === 'paused' ? 'Продовжити' : 'Пауза'}
                  </button>
                )}
                <button type="button" className="job-action is-danger" disabled={!!busy} onClick={() => setConfirmDelete(true)}>
                  <span>
                    <Trash2 size={20} />
                  </span>
                  Видалити
                </button>
              </div>
              {confirmDelete && (
                <div className="confirm">
                  <span>Видалити задачу «{job.name}» назавжди?</span>
                  <div>
                    <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                      Скасувати
                    </button>
                    <button type="button" className="btn btn-danger-solid" disabled={busy === 'delete'} onClick={() => void remove()}>
                      {busy === 'delete' ? <Loader2 size={16} className="spin" /> : 'Видалити'}
                    </button>
                  </div>
                </div>
              )}
              {(job.last_error || job.last_delivery_error) && status !== 'done' && (
                <div className="msg-error">
                  <AlertTriangle size={16} />
                  <span>{job.last_error || `Не вдалося доставити: ${job.last_delivery_error}`}</span>
                </div>
              )}
            </div>
          )}

          <div className="form-card">
            <label className="field">
              <span className="field-label">Назва</span>
              <input value={form.name} placeholder="Наприклад, ранковий дайджест" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">{job?.no_agent ? 'Опис' : 'Що зробити'}</span>
              <textarea
                ref={area}
                rows={4}
                value={form.prompt}
                placeholder="Що Hermes має зробити щоразу. Пиши як у чаті: «Збери головні новини про ШІ за добу й коротко підсумуй»."
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
              {job?.no_agent && <span className="field-hint">Ця задача запускає скрипт без агента, текст лише описує її.</span>}
            </label>
          </div>

          <div className="form-card">
            <span className="field-label">Коли</span>
            <ScheduleEditor value={form.draft} onChange={(draft) => setForm({ ...form, draft })} />
          </div>

          <div className="form-card">
            <span className="field-label">
              <Send size={13} /> Куди надсилати результат
            </span>
            <div className="seg seg-wide">
              {deliverOptions.map((o) => (
                <button key={o.v} type="button" className={form.deliver === o.v ? 'is-on' : ''} onClick={() => setForm({ ...form, deliver: o.v })}>
                  {o.label}
                </button>
              ))}
            </div>
            {form.draft.mode !== 'once' && (
              <div className="field-inline repeat-row">
                <span>Повторів</span>
                <div className="seg seg-small">
                  <button type="button" className={form.repeat == null ? 'is-on' : ''} onClick={() => setForm({ ...form, repeat: null })}>
                    Без обмежень
                  </button>
                  <button type="button" className={form.repeat != null ? 'is-on' : ''} onClick={() => setForm({ ...form, repeat: form.repeat ?? 10 })}>
                    Обмежити
                  </button>
                </div>
                {form.repeat != null && (
                  <input type="number" inputMode="numeric" min={1} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: Math.max(1, Number(e.target.value) || 1) })} />
                )}
              </div>
            )}
            {job && job.repeat.completed > 0 && <span className="field-hint">Виконано разів: {job.repeat.completed}</span>}
          </div>

          {job && (
            <section className="runs">
              <h2>Історія запусків</h2>
              {runs == null ? (
                <Loader2 size={18} className="spin" />
              ) : runs.length === 0 ? (
                <p className="muted">{job.no_agent ? 'Скрипт не зберігає історію в Hermes.' : 'Ще не запускалась.'}</p>
              ) : (
                runs.map((r) => <RunRow key={r.sessionId} run={r} now={now} />)
              )}
            </section>
          )}
        </div>
      </div>

      {(dirty || !job) && (
        <div className="save-bar">
          {invalid && (dirty || form.name) ? <span className="save-hint">{invalid}</span> : <span className="save-hint">{job ? 'Є незбережені зміни' : 'Нова задача'}</span>}
          {job && (
            <button type="button" className="btn" onClick={() => setForm(saved)}>
              Скасувати
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!!invalid || busy === 'save'} onClick={() => void save()}>
            {busy === 'save' ? <Loader2 size={16} className="spin" /> : job ? 'Зберегти' : 'Створити'}
          </button>
        </div>
      )}
      {notice && <div className="toast toast-ok">{notice}</div>}
    </>
  )
}

export function JobsView(props: Props) {
  return <div className="jobs-view">{props.route.kind === 'list' ? <JobsList {...props} /> : <JobPage key={props.route.kind === 'job' ? props.route.id : 'new'} {...props} />}</div>
}
