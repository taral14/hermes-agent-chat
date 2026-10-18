// Розклад cron-задач: опис людською мовою, редагування і відносний час.
import type { Job, JobSchedule } from './shared.ts'

export const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] as const
const EVERY_DAY = ['Щопонеділка', 'Щовівторка', 'Щосереди', 'Щочетверга', 'Щоп’ятниці', 'Щосуботи', 'Щонеділі']
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']

/** cron: 0 = неділя (і 7 теж), у нас індекс 0 = понеділок. */
const cronDayToIdx = (d: number) => (d + 6) % 7
const idxToCronDay = (i: number) => (i + 1) % 7

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`

export type Draft =
  | { mode: 'daily'; time: string }
  | { mode: 'weekdays'; time: string }
  | { mode: 'days'; time: string; days: number[] }
  | { mode: 'interval'; every: number; unit: 'm' | 'h' | 'd' }
  | { mode: 'once'; at: string }
  | { mode: 'cron'; expr: string }

export const MODES: { mode: Draft['mode']; label: string }[] = [
  { mode: 'daily', label: 'Щодня' },
  { mode: 'weekdays', label: 'Будні' },
  { mode: 'days', label: 'Дні тижня' },
  { mode: 'interval', label: 'Інтервал' },
  { mode: 'once', label: 'Один раз' },
  { mode: 'cron', label: 'Cron' },
]

function parseDays(field: string): number[] | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part)
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) out.add(cronDayToIdx(d % 7))
    } else if (/^\d$/.test(part)) out.add(cronDayToIdx(Number(part) % 7))
    else return null
  }
  return [...out].sort((a, b) => a - b)
}

function simpleCron(expr: string): { m: number; h: number; days: number[] | 'all' } | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5 || !/^\d+$/.test(f[0]!) || !/^\d+$/.test(f[1]!) || f[2] !== '*' || f[3] !== '*') return null
  const days = f[4] === '*' ? 'all' : parseDays(f[4]!)
  return days ? { m: Number(f[0]), h: Number(f[1]), days } : null
}

function localInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toDraft(s: JobSchedule | undefined): Draft {
  if (!s) return { mode: 'daily', time: '09:00' }
  if (s.kind === 'interval') {
    const m = s.minutes
    if (m % 1440 === 0) return { mode: 'interval', every: m / 1440, unit: 'd' }
    if (m % 60 === 0) return { mode: 'interval', every: m / 60, unit: 'h' }
    return { mode: 'interval', every: m, unit: 'm' }
  }
  if (s.kind === 'once') return { mode: 'once', at: localInput(new Date(s.run_at)) }
  const c = simpleCron(s.expr)
  if (!c) return { mode: 'cron', expr: s.expr }
  const time = hhmm(c.h, c.m)
  if (c.days === 'all' || c.days.length === 7) return { mode: 'daily', time }
  if (c.days.join() === '0,1,2,3,4') return { mode: 'weekdays', time }
  return { mode: 'days', time, days: c.days }
}

/** Рядок розкладу у форматі, який розуміє Hermes (cron, `every Nm`, ISO-час). */
export function fromDraft(d: Draft): string {
  const [h, m] = 'time' in d ? d.time.split(':').map(Number) : [0, 0]
  switch (d.mode) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'days':
      return `${m} ${h} * * ${d.days.map(idxToCronDay).sort((a, b) => a - b).join(',')}`
    case 'interval':
      return `every ${Math.max(1, Math.round(d.every)) * (d.unit === 'd' ? 1440 : d.unit === 'h' ? 60 : 1)}m`
    case 'once': {
      const date = new Date(d.at)
      const off = -date.getTimezoneOffset()
      const sign = off >= 0 ? '+' : '-'
      return `${d.at}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
    }
    case 'cron':
      return d.expr.trim()
  }
}

export function draftValid(d: Draft): string | null {
  if ('time' in d && !/^\d{2}:\d{2}$/.test(d.time)) return 'Вкажи час'
  if (d.mode === 'days' && !d.days.length) return 'Обери хоча б один день'
  if (d.mode === 'interval' && !(d.every >= 1)) return 'Інтервал має бути більшим за нуль'
  if (d.mode === 'once' && !(new Date(d.at).getTime() > Date.now())) return 'Обери час у майбутньому'
  if (d.mode === 'cron' && d.expr.trim().split(/\s+/).length < 5) return 'Cron-вираз має 5 полів'
  return null
}

function describeDays(days: number[]) {
  if (days.length === 1) return EVERY_DAY[days[0]!]!
  if (days.join() === '0,1,2,3,4') return 'По буднях'
  if (days.join() === '5,6') return 'На вихідних'
  return days.map((d) => DAYS[d]).join(', ')
}

function describeCron(expr: string): string {
  const c = simpleCron(expr)
  if (c) {
    const at = `о ${hhmm(c.h, c.m)}`
    if (c.days === 'all' || c.days.length === 7) return `Щодня ${at}`
    return `${describeDays(c.days)} ${at}`
  }
  // «0 8-16 * * 3» → щосереди щогодини з 08:00 до 16:00
  const f = expr.trim().split(/\s+/)
  const range = f.length === 5 ? /^(\d+)-(\d+)$/.exec(f[1]!) : null
  if (range && /^\d+$/.test(f[0]!) && f[2] === '*' && f[3] === '*') {
    const days = f[4] === '*' ? null : parseDays(f[4]!)
    const span = `щогодини з ${hhmm(Number(range[1]), Number(f[0]))} до ${hhmm(Number(range[2]), Number(f[0]))}`
    return days ? `${describeDays(days)} ${span}` : span[0]!.toUpperCase() + span.slice(1)
  }
  if (f.length === 5 && /^\*\/(\d+)$/.test(f[0]!) && f.slice(1).every((x) => x === '*')) return `Кожні ${f[0]!.slice(2)} хв`
  return `Cron: ${expr}`
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function describeSchedule(s: JobSchedule): string {
  if (s.kind === 'interval') {
    const m = s.minutes
    if (m === 60) return 'Щогодини'
    if (m === 1440) return 'Щодня'
    if (m % 1440 === 0) return `Кожні ${m / 1440} ${plural(m / 1440, 'день', 'дні', 'днів')}`
    if (m % 60 === 0) return `Кожні ${m / 60} год`
    return `Кожні ${m} хв`
  }
  if (s.kind === 'once') return `Один раз · ${formatDate(new Date(s.run_at), true)}`
  return describeCron(s.expr)
}

export function describeDraft(d: Draft): string {
  const err = draftValid(d)
  if (err) return err
  const s = fromDraft(d)
  if (d.mode === 'interval') return describeSchedule({ kind: 'interval', minutes: Number(s.match(/\d+/)![0]) })
  if (d.mode === 'once') return describeSchedule({ kind: 'once', run_at: d.at })
  return describeCron(s)
}

export function formatDate(d: Date, withYear = false) {
  const now = new Date()
  const year = withYear || d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${hhmm(d.getHours(), d.getMinutes())}`
}

function dayDiff(a: Date, b: Date) {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((x - y) / 86400_000)
}

/** Наступний запуск: якщо час уже настав, Hermes от-от його виконає. */
export function nextRun(iso: string | null | undefined, now = Date.now()): string {
  if (iso && new Date(iso).getTime() <= now) return 'зараз'
  return relative(iso, now)
}

/** «через 15 хв», «завтра о 07:20», «вчора о 10:10», «5 листопада, 09:00». */
export function relative(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = d.getTime() - now
  const at = `о ${hhmm(d.getHours(), d.getMinutes())}`
  const days = dayDiff(d, new Date(now))
  if (diff > 0 && diff < 60_000) return 'менш ніж за хвилину'
  if (diff > 0 && diff < 3600_000) return `через ${Math.round(diff / 60_000)} хв`
  if (diff <= 0 && diff > -60_000) return 'щойно'
  if (diff < 0 && diff > -3600_000) return `${Math.max(1, Math.round(-diff / 60_000))} хв тому`
  if (days === 0) return `сьогодні ${at}`
  if (days === 1) return `завтра ${at}`
  if (days === -1) return `вчора ${at}`
  if (days > 1 && days < 7) return `${DAYS[(d.getDay() + 6) % 7]!.toLowerCase()} ${at}`
  return formatDate(d)
}

export type JobStatus = 'active' | 'paused' | 'done' | 'error' | 'running'

export function jobStatus(j: Job): JobStatus {
  if (j.state === 'running') return 'running'
  if (j.state === 'completed' || (j.repeat.times != null && j.repeat.completed >= j.repeat.times && !j.next_run_at)) return 'done'
  if (j.schedule.kind === 'once' && j.repeat.completed >= (j.repeat.times ?? 1)) return 'done'
  if (!j.enabled || j.state === 'paused' || j.paused_at) return 'paused'
  if (j.last_status && !/^(ok|success|completed|skipped)$/i.test(j.last_status)) return 'error'
  return 'active'
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  active: 'Активна',
  paused: 'На паузі',
  done: 'Виконано',
  error: 'Помилка',
  running: 'Виконується',
}

export function deliverLabel(j: Pick<Job, 'deliver' | 'origin'>): string {
  const v = (j.deliver || 'local').toLowerCase()
  const platform = (p?: string) =>
    p ? (p === 'telegram' ? 'Telegram' : p === 'webchat' ? 'Веб-чат' : p[0]!.toUpperCase() + p.slice(1)) : 'туди, звідки створено'
  if (v === 'local') return 'Лише зберігати'
  if (v === 'origin') return platform(j.origin?.platform)
  return v.split(',').map((x) => platform(x.split(':')[0])).join(', ')
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} хв`
  return `${Math.floor(m / 60)} год ${m % 60} хв`
}
