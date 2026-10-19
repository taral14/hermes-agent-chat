// Які задачі за розкладом доставляють результати в який чат. Hermes зберігає це в полі deliver:
// «webchat» — чат «Розклад», «webchat:<id чату або назва каналу>» — конкретний чат.
// З цього бічна панель будує групу «Задачі», а Hermes у запиті бачить задачі поточного чату.
import type { ChatJob, Job } from '../src/shared.ts'
import { findChannelChat } from './inbox.ts'
import { listJobs } from './jobs.ts'

let byChat = new Map<string, ChatJob[]>()
let jobChat = new Map<string, string>()
let lastOk = 0
let running: Promise<string[]> | null = null

const finished = (j: Job) => j.state === 'completed' || (j.repeat?.times != null && j.repeat.completed >= j.repeat.times && !j.enabled)

function chatsOf(deliver: string): string[] {
  const out: string[] = []
  for (const raw of (deliver || '').split(',')) {
    const t = raw.trim()
    if (t !== 'webchat' && !t.startsWith('webchat:')) continue
    const id = findChannelChat(t === 'webchat' ? '' : t.slice('webchat:'.length))
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Перечитати задачі з Hermes. Повертає чати, у яких список задач змінився. */
export function refreshJobLinks(): Promise<string[]> {
  if (running) return running
  running = (async () => {
    let jobs: Job[]
    try {
      jobs = await listJobs()
    } catch {
      return []
    }
    const next = new Map<string, ChatJob[]>()
    const nextJob = new Map<string, string>()
    for (const j of jobs) {
      if (finished(j)) continue
      for (const chatId of chatsOf(j.deliver)) {
        const brief: ChatJob = { id: j.id, name: j.name || j.id, enabled: j.enabled, schedule: j.schedule_display || j.schedule?.display || '', nextRunAt: j.next_run_at }
        next.set(chatId, [...(next.get(chatId) ?? []), brief])
        nextJob.set(j.id, chatId)
      }
    }
    const changed: string[] = []
    for (const id of new Set([...byChat.keys(), ...next.keys()])) {
      if (JSON.stringify(byChat.get(id) ?? []) !== JSON.stringify(next.get(id) ?? [])) changed.push(id)
    }
    byChat = next
    jobChat = nextJob
    lastOk = Date.now()
    return changed
  })().finally(() => {
    running = null
  })
  return running
}

export const jobsForChat = (chatId: string): ChatJob[] => byChat.get(chatId) ?? []
export const chatForJob = (jobId: string): string | null => jobChat.get(jobId) ?? null
export const jobLinksAge = () => Date.now() - lastOk
/** Чати, у які зараз пише хоч одна задача. */
export const linkedChats = (): string[] => [...byChat.keys()]

/**
 * Що Hermes має знати про задачі в цьому чаті: куди доставляти нові й якими вже можна керувати.
 * Додається до запиту з чату, тож «вимкни», «перенеси на 9:00» Hermes виконає сам через cronjob_manage.
 */
export function jobContext(chatId: string): string {
  const jobs = jobsForChat(chatId)
  const lines = [
    `[Веб-чат: id цієї розмови — ${chatId}. Якщо створюєш задачу за розкладом (cronjob_manage) з цієї розмови, ` +
      `став deliver="webchat:${chatId}", щоб результати приходили сюди, у цю ж розмову (якщо користувач не просить іншого).`,
  ]
  if (jobs.length) {
    lines.push('Задачі, що зараз доставляють результати в цю розмову:')
    for (const j of jobs) lines.push(`- «${j.name}» (job_id ${j.id}; ${j.schedule || 'розклад невідомий'}; ${j.enabled ? 'увімкнена' : 'на паузі'})`)
    lines.push('Коли користувач просить змінити, призупинити, відновити чи видалити таку задачу, роби це через cronjob_manage з цим job_id.')
  }
  return `${lines.join('\n')}]`
}
