// Веб-пуші: Hermes відповів, просить дозволу чи уточнення, виконав задачу за розкладом.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import type { Job, Message, Part } from '../src/shared.ts'
import { VAPID_SUBJECT } from './config.ts'
import { DATA_DIR, type PushSub, deletePushSub, getChat, listPushSubs } from './db.ts'
import { jobRuns, listJobs, runOutput } from './jobs.ts'

const VAPID_FILE = join(DATA_DIR, '.vapid.json')

type Keys = { publicKey: string; privateKey: string }
function vapid(): Keys {
  if (!existsSync(VAPID_FILE)) writeFileSync(VAPID_FILE, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 })
  return JSON.parse(readFileSync(VAPID_FILE, 'utf8')) as Keys
}
const keys = vapid()
webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey)
export const VAPID_PUBLIC = keys.publicKey

export type Payload = {
  title: string
  body: string
  url: string
  tag: string
  requireInteraction?: boolean
  actions?: { action: string; title: string }[]
  data?: Record<string, unknown>
}

type Kind = 'replies' | 'prompts' | 'jobs'

async function deliver(sub: PushSub, p: Payload, urgency: 'normal' | 'high' = 'normal') {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(p), { TTL: 24 * 3600, urgency })
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode
    // Підписка більше не дійсна (застосунок видалили, дозвіл забрали).
    if (code === 404 || code === 410) deletePushSub(sub.endpoint)
    else console.warn(`[push] ${code ?? ''} ${(err as Error).message}`)
  }
}

export async function send(kind: Kind, p: Payload, urgency: 'normal' | 'high' = 'normal') {
  await Promise.all(listPushSubs().filter((s) => s.settings[kind]).map((s) => deliver(s, p, urgency)))
}

export async function sendTest(sub: PushSub) {
  await deliver(sub, { title: 'Hermes', body: 'Сповіщення працюють 👌', url: '/', tag: 'test' }, 'high')
}

// ---------- Хто зараз дивиться на екран ----------

const presence = new Map<string, { visible: boolean; chatId: string | null; at: number }>()

export function setPresence(clientId: string, visible: boolean, chatId: string | null) {
  presence.set(clientId, { visible, chatId, at: Date.now() })
  for (const [id, p] of presence) if (Date.now() - p.at > 10 * 60_000) presence.delete(id)
}

/** Чат відкритий у видимій вкладці: пуш не потрібен, людина й так бачить відповідь. */
function watching(chatId: string) {
  for (const p of presence.values()) if (p.visible && p.chatId === chatId && Date.now() - p.at < 3 * 60_000) return true
  return false
}

const plain = (md: string, max = 160) => {
  const t = md
    .replace(/```[\s\S]*?```/g, ' [код] ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

// ---------- Події чату ----------

export function runFinished(m: Message) {
  if (watching(m.chatId)) return
  const chat = getChat(m.chatId)
  const title = chat?.title || 'Hermes'
  let body: string
  if (m.status === 'done') body = plain(m.text) || (m.attachments.length ? `Надіслав файл: ${m.attachments.map((a) => a.name).join(', ')}` : 'Готово')
  else if (m.status === 'cancelled') return
  else body = `⚠️ ${m.error ?? 'Задача не завершилась'}`
  void send('replies', { title, body, url: `/c/${m.chatId}`, tag: `chat-${m.chatId}` })
}

/** Hermes сам написав у чат (розклад, send_message). Результати розкладу — під перемикачем «Задачі». */
export function hermesDelivered(m: Message) {
  if (watching(m.chatId)) return
  const d = m.parts.find((p) => p.type === 'delivered') as Extract<Part, { type: 'delivered' }> | undefined
  const chat = getChat(m.chatId)
  const title = d?.source === 'cron' && d.job ? `⏰ ${d.job}` : chat?.title || 'Hermes'
  const body = plain(m.text) || (m.attachments.length ? `Надіслав файл: ${m.attachments.map((a) => a.name).join(', ')}` : 'Нове повідомлення')
  void send(d?.source === 'cron' ? 'jobs' : 'replies', { title, body, url: `/c/${m.chatId}`, tag: `hermes-${m.id}` })
}

export function promptRaised(m: Message, p: Extract<Part, { type: 'approval' | 'clarify' }>) {
  if (watching(m.chatId)) return
  const chat = getChat(m.chatId)
  const data = { messageId: m.id, promptId: p.promptId, generation: p.generation }
  if (p.type === 'approval') {
    void send(
      'prompts',
      {
        title: 'Hermes просить дозволу',
        body: `${p.description ? p.description + ': ' : ''}${p.command}`.slice(0, 200),
        url: `/c/${m.chatId}`,
        tag: `prompt-${p.promptId}`,
        requireInteraction: true,
        actions: [
          { action: 'once', title: 'Дозволити' },
          { action: 'deny', title: 'Відхилити' },
        ],
        data,
      },
      'high',
    )
  } else {
    void send(
      'prompts',
      { title: `Hermes уточнює · ${chat?.title ?? ''}`.replace(/ · $/, ''), body: plain(p.question, 200), url: `/c/${m.chatId}`, tag: `prompt-${p.promptId}`, requireInteraction: true, data },
      'high',
    )
  }
}

// ---------- Задачі за розкладом ----------

const lastSeen = new Map<string, string | null>()
let primed = false

export const jobsWatched = () => listPushSubs().some((s) => s.settings.jobs)

/** Раз на хвилину дивимось, чи якась задача (не скрипт) щойно відпрацювала. */
async function pollJobs() {
  if (!jobsWatched()) {
    primed = false
    return
  }
  let jobs: Job[]
  try {
    jobs = await listJobs()
  } catch {
    return
  }
  for (const j of jobs) {
    const prev = lastSeen.get(j.id)
    lastSeen.set(j.id, j.last_run_at)
    if (!primed || j.no_agent || !j.last_run_at || prev === j.last_run_at) continue
    const failed = j.last_status && !/^(ok|success|completed|skipped)$/i.test(j.last_status)
    let body = failed ? `⚠️ ${j.last_error ?? 'Помилка'}` : 'Виконано'
    if (!failed) {
      try {
        const [run] = await jobRuns(j.id, 1)
        if (run) body = plain(await runOutput(run.sessionId)) || body
      } catch {
        /* без тексту */
      }
    }
    void send('jobs', { title: `${failed ? 'Не вдалося' : 'Розклад'} · ${j.name}`, body, url: `/jobs/${j.id}`, tag: `job-${j.id}` })
  }
  primed = true
}

setInterval(() => void pollJobs(), 60_000).unref()
setTimeout(() => void pollJobs(), 5_000).unref()
