import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
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
import { useAutosize } from '../hooks/useAutosize.ts'
import { useJobForm } from '../hooks/useJobForm.ts'
import { useTick } from '../hooks/useTick.ts'
import { navigateTo } from '../router.ts'
import { STATUS_LABEL, deliverLabel, describeSchedule, duration, jobStatus, nextRun, plural, relative } from '../schedule.ts'
import type { Job, JobChatInfo, JobRun } from '../shared.ts'
import { Markdown } from './Markdown.tsx'
import { ScheduleEditor } from './ScheduleEditor.tsx'
import { Switch } from './ui/Switch.tsx'
import { TopBar } from './ui/TopBar.tsx'

export type JobsRoute = { kind: 'list' } | { kind: 'job'; id: string } | { kind: 'new' }

type Props = {
  route: JobsRoute
  go: (r: JobsRoute | null) => void
  sidebarOpen: boolean
  openSidebar: () => void
  flash: (e: unknown) => void
}

function StatusPill({ job }: { job: Job }) {
  const s = jobStatus(job)
  return <span className={`pill pill-${s}`}>{STATUS_LABEL[s]}</span>
}

// ---------- Список ----------

/** Перейти в чат застосунку без перезавантаження сторінки (cmd/ctrl-клік — у новій вкладці). */
function openChat(e: React.MouseEvent, chatId: string) {
  if (e.metaKey || e.ctrlKey) return
  e.preventDefault()
  navigateTo(`/c/${chatId}`)
}

function JobRow({ job, now, onOpen, onToggle, extra }: { job: Job; now: number; onOpen: () => void; onToggle: (on: boolean) => Promise<void>; extra?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const status = jobStatus(job)
  const toggleable = status !== 'done'
  const isOn = status !== 'paused' && status !== 'done'
  const when =
    status === 'done' ? `виконано ${relative(job.last_run_at, now)}` : status === 'paused' ? 'на паузі' : nextRun(job.next_run_at, now)
  return (
    <div className={`job-row is-${status}`}>
      {/* Увесь рядок відкриває задачу (::after кнопки), а перемикач і «У чат» — окремі кнопки поверх. */}
      <button type="button" className="job-row-open" onClick={onOpen}>
      <span className="job-row-icon">
        {status === 'error' ? <AlertTriangle size={16} /> : job.no_agent ? <FileCode2 size={16} /> : job.schedule.kind === 'once' ? <CalendarClock size={16} /> : <Repeat size={16} />}
      </span>
      <span className="job-row-main">
        <span className="job-row-name">{job.name}</span>
        <span className="job-row-sub">
          {describeSchedule(job.schedule)}
          {/* В одноразової задачі розклад уже і є час запуску. */}
          {(status !== 'active' || job.schedule.kind !== 'once') && (
            <>
              {' · '}
              <span className={status === 'error' ? 'is-error' : ''}>{status === 'error' ? 'остання спроба не вдалася' : when}</span>
            </>
          )}
        </span>
      </span>
      </button>
      {extra}
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
  )
}

/** Чат, у який пишуть задачі: останній результат і самі задачі. */
function ChatCard({ chat, jobs, now, row }: { chat: JobChatInfo; jobs: Job[]; now: number; row: (j: Job) => ReactNode }) {
  return (
    <div className="chat-card">
      <a className="chat-card-head" href={`/c/${chat.id}`} onClick={(e) => openChat(e, chat.id)}>
        <span className="chat-card-icon">
          <MessageSquare size={18} />
        </span>
        <span className="chat-card-title">{chat.title}</span>
        {chat.last && <span className="chat-card-time">{relative(new Date(chat.last.at).toISOString(), now)}</span>}
        <ChevronRight size={18} className="chat-card-go" />
      </a>
      <a className="chat-card-last" href={`/c/${chat.id}`} onClick={(e) => openChat(e, chat.id)}>
        {chat.last ? chat.last.text : 'Ще нічого не надсилали — перше повідомлення прийде після запуску задачі.'}
      </a>
      <div className="job-rows">{jobs.map(row)}</div>
    </div>
  )
}

/** Згортувана група (службові, виконані). */
function Fold({ title, hint, count, children }: { title: string; hint: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={`jobs-section jobs-fold ${open ? 'is-open' : ''}`}>
      <button type="button" className="jobs-fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <b>{title}</b> · {count}
        </span>
        <span className="jobs-fold-hint">{hint}</span>
        <ChevronDown size={18} className="jobs-fold-chevron" />
      </button>
      {open && <div className="job-list">{children}</div>}
    </section>
  )
}

const nextAt = (j: Job) => (j.next_run_at ? new Date(j.next_run_at).getTime() : Infinity)
const byNext = (a: Job, b: Job) => Number(jobStatus(a) === 'paused') - Number(jobStatus(b) === 'paused') || nextAt(a) - nextAt(b)

function JobsList({ go, sidebarOpen, openSidebar, flash }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [chats, setChats] = useState<JobChatInfo[]>([])
  const [moving, setMoving] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const now = useTick()
  const load = useCallback(
    () =>
      Promise.all([api.jobChats().then(setChats), api.jobs().then(setJobs)]).catch(flash),
    [flash],
  )
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const groups = useMemo(() => {
    const chatIds = new Set(chats.map((c) => c.id))
    const byChat = new Map<string, Job[]>()
    const elsewhere = new Map<string, Job[]>()
    const service: Job[] = []
    const done: Job[] = []
    let active = 0
    let paused = 0
    for (const j of jobs ?? []) {
      const s = jobStatus(j)
      if (s === 'done') {
        done.push(j)
        continue
      }
      if (s === 'paused') paused++
      else active++
      if (j.chatId && chatIds.has(j.chatId)) byChat.set(j.chatId, [...(byChat.get(j.chatId) ?? []), j])
      else if (j.no_agent || (j.deliver || 'local') === 'local') service.push(j)
      else {
        const label = deliverLabel(j)
        elsewhere.set(label, [...(elsewhere.get(label) ?? []), j])
      }
    }
    for (const list of [...byChat.values(), ...elsewhere.values(), service]) list.sort(byNext)
    done.sort((a, b) => (b.last_run_at ?? '').localeCompare(a.last_run_at ?? ''))
    return { byChat, elsewhere: [...elsewhere.entries()], service, done, active, paused }
  }, [jobs, chats])

  const toggle = async (job: Job, on: boolean) => {
    try {
      const updated = await api.jobAction(job.id, on ? 'resume' : 'pause')
      setJobs((list) => list?.map((j) => (j.id === job.id ? { ...j, ...updated } : j)) ?? null)
    } catch (e) {
      flash(e)
    }
  }

  /** Перенести задачу в окремий чат: далі вона пише туди, а не в Telegram. */
  const moveToChat = async (job: Job) => {
    setMoving(job.id)
    try {
      await api.updateJob(job.id, { deliver: 'webchat:new' })
      await load()
      setNotice(`«${job.name}» тепер пише в окремий чат`)
      setTimeout(() => setNotice(''), 3000)
    } catch (e) {
      flash(e)
    } finally {
      setMoving(null)
    }
  }

  const row = (j: Job, extra?: ReactNode) => (
    <JobRow key={j.id} job={j} now={now} onOpen={() => go({ kind: 'job', id: j.id })} onToggle={(on) => toggle(j, on)} extra={extra} />
  )
  const moveButton = (j: Job) => (
    <button
      type="button"
      className="job-move"
      disabled={moving != null}
      title="Результати приходитимуть в окремий чат замість поточного місця"
      onClick={(e) => {
        e.stopPropagation()
        void moveToChat(j)
      }}
    >
      {moving === j.id ? <Loader2 size={14} className="spin" /> : <MessageSquarePlus size={14} />}
      <span>У чат</span>
    </button>
  )

  const soonest = (jobs ?? []).filter((j) => jobStatus(j) === 'active' && j.next_run_at).sort(byNext)[0]
  const chatCards = chats.filter((c) => groups.byChat.has(c.id))
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
                  : `${groups.active} активних${groups.paused ? ` · ${groups.paused} на паузі` : ''}${soonest ? ` · наступна ${nextRun(soonest.next_run_at, now)}` : ''}`}
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
              <p>Ще немає жодної задачі. Попроси Hermes у будь-якому чаті нагадувати, перевіряти чи збирати щось регулярно — або створи її тут.</p>
              <button type="button" className="btn btn-primary" onClick={() => go({ kind: 'new' })}>
                <Plus size={16} /> Нова задача
              </button>
            </div>
          )}
          {jobs != null && jobs.length > 0 && (
            <section className="jobs-section">
              <h2>Чати</h2>
              {chatCards.length ? (
                <div className="jobs-grid">
                  {chatCards.map((c) => (
                    <ChatCard key={c.id} chat={c} jobs={groups.byChat.get(c.id)!} now={now} row={(j) => row(j)} />
                  ))}
                </div>
              ) : (
                <div className="jobs-tip">
                  <MessageSquare size={20} />
                  <p>
                    Задача може писати в окремий чат: результати збираються в одній розмові, їх можна розпитати, а саму задачу змінити чи
                    вимкнути словами. Натисни «У чат» біля задачі нижче або створи нову.
                  </p>
                </div>
              )}
            </section>
          )}
          {groups.elsewhere.map(([label, list]) => (
            <section key={label} className="jobs-section">
              <h2>{label}</h2>
              <div className="job-list">{list.map((j) => row(j, moveButton(j)))}</div>
            </section>
          ))}
          {groups.service.length > 0 && (
            <Fold title="Службові" hint="скрипти й задачі без сповіщень" count={groups.service.length}>
              {groups.service.map((j) => row(j))}
            </Fold>
          )}
          {groups.done.length > 0 && (
            <Fold title="Виконані" hint="одноразові, що вже відпрацювали" count={groups.done.length}>
              {groups.done.map((j) => row(j))}
            </Fold>
          )}
        </div>
      </div>
      <button type="button" className="fab only-narrow" onClick={() => go({ kind: 'new' })} aria-label="Нова задача">
        <Plus size={24} />
      </button>
      {notice && <div className="toast toast-ok">{notice}</div>}
    </>
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
          {run.tools ? ` · ${run.tools} ${plural(run.tools, 'дія', 'дії', 'дій')}` : ''}
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

function JobPage({ route, go, sidebarOpen, openSidebar, flash }: Props) {
  const id = route.kind === 'job' ? route.id : null
  const toList = useCallback(() => go({ kind: 'list' }), [go])
  const { job, form, setForm, reset, dirty, invalid, busy, notice, show, save, act, remove } = useJobForm(id, { flash, onMissing: toList })
  const [runs, setRuns] = useState<JobRun[] | null>(null)
  const [chats, setChats] = useState<JobChatInfo[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const now = useTick()
  useAutosize(area, form.prompt, 360)

  // Чати з задачами: щоб показати «Чат «назва»» серед варіантів доставки. Перечитуємо, коли зв'язок змінився.
  useEffect(() => {
    api.jobChats().then(setChats).catch(() => {})
  }, [job?.chatId])
  const loadRuns = useCallback(() => {
    if (id) api.jobRuns(id).then(setRuns).catch(() => setRuns([]))
  }, [id])
  useEffect(loadRuns, [loadRuns])

  const status = job ? jobStatus(job) : 'active'
  /** Назад до списку; незбережені зміни — спершу спитати. */
  const back = () => (dirty ? setConfirmLeave(true) : toList())

  const onSave = async () => {
    const r = await save()
    if (r && !job) go({ kind: 'job', id: r.id })
  }
  const onAct = async (action: 'pause' | 'resume' | 'run') => {
    if (!(await act(action)) || action !== 'run') return
    show('Запущено — результат прийде туди, куди надсилається задача', 4000)
    setTimeout(loadRuns, 4000)
  }
  const onRemove = async () => {
    if (await remove()) toList()
  }

  if (id && !job) {
    return (
      <>
        <TopBar title="Задача" back={toList} sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
        <div className="jobs-loading">
          <Loader2 size={22} className="spin" />
        </div>
      </>
    )
  }

  const linked = job?.chatId ? chats.find((c) => c.id === job.chatId) : undefined
  const deliverOptions = [
    ...(linked && job ? [{ v: job.deliver, label: `Чат «${linked.title}»` }] : []),
    { v: 'webchat:new', label: linked ? 'Новий чат' : 'Окремий чат' },
    { v: 'telegram', label: 'Telegram' },
    ...(job?.origin?.platform && !['telegram', 'api_server', 'local'].includes(job.origin.platform) ? [{ v: 'origin', label: deliverLabel({ deliver: 'origin', origin: job.origin }) }] : []),
    { v: 'local', label: 'Лише зберігати' },
  ]
  if (!deliverOptions.some((o) => o.v === form.deliver)) deliverOptions.unshift({ v: form.deliver, label: deliverLabel({ deliver: form.deliver, origin: job?.origin ?? null }) })

  return (
    <>
      <TopBar title={job ? 'Задача' : 'Нова задача'} back={back} sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
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
                <button type="button" className="job-action" disabled={!!busy} onClick={() => void onAct('run')}>
                  <span>{busy === 'run' ? <Loader2 size={20} className="spin" /> : <Zap size={20} />}</span>
                  Запустити
                </button>
                {status !== 'done' && (
                  <button type="button" className="job-action" disabled={!!busy} onClick={() => void onAct(status === 'paused' ? 'resume' : 'pause')}>
                    <span>{status === 'paused' ? <Play size={20} /> : <Pause size={20} />}</span>
                    {status === 'paused' ? 'Продовжити' : 'Пауза'}
                  </button>
                )}
                {job.chatId && (
                  <a
                    className="job-action"
                    href={`/c/${job.chatId}`}
                    onClick={(e) => openChat(e, job.chatId!)}
                  >
                    <span>
                      <MessageSquare size={20} />
                    </span>
                    Чат
                  </a>
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
                    <button type="button" className="btn btn-danger-solid" disabled={busy === 'delete'} onClick={() => void onRemove()}>
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
                <button key={o.v} type="button" aria-pressed={form.deliver === o.v} className={form.deliver === o.v ? 'is-on' : ''} onClick={() => setForm({ ...form, deliver: o.v })}>
                  {o.label}
                </button>
              ))}
            </div>
            {form.deliver === 'webchat:new' && (
              <span className="field-hint">
                {job ? 'Після збереження' : 'Після створення'} з'явиться чат «{form.name.trim() || 'Задача'}» у групі «Задачі». Туди приходитимуть
                результати, і там можна попросити змінити чи вимкнути задачу.
              </span>
            )}
            {form.draft.mode !== 'once' && (
              <div className="field-inline repeat-row">
                <span>Повторів</span>
                <div className="seg seg-small">
                  <button type="button" aria-pressed={form.repeat == null} className={form.repeat == null ? 'is-on' : ''} onClick={() => setForm({ ...form, repeat: null })}>
                    Без обмежень
                  </button>
                  <button type="button" aria-pressed={form.repeat != null} className={form.repeat != null ? 'is-on' : ''} onClick={() => setForm({ ...form, repeat: form.repeat ?? 10 })}>
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

      {!confirmLeave && (dirty || !job) && (
        <div className="save-bar">
          {invalid && (dirty || form.name) ? <span className="save-hint">{invalid}</span> : <span className="save-hint">{job ? 'Є незбережені зміни' : 'Нова задача'}</span>}
          {job && (
            <button type="button" className="btn" onClick={reset}>
              Скасувати
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!!invalid || busy === 'save'} onClick={() => void onSave()}>
            {busy === 'save' ? <Loader2 size={16} className="spin" /> : job ? 'Зберегти' : 'Створити'}
          </button>
        </div>
      )}
      {confirmLeave && (
        <div className="save-bar is-warn">
          <span className="save-hint">Зміни не збережено. Вийти без збереження?</span>
          <button type="button" className="btn" onClick={() => setConfirmLeave(false)}>
            Лишитись
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={toList}>
            Не зберігати
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
