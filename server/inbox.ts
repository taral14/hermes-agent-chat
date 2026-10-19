// Вхідні від Hermes: повідомлення, які Hermes надсилає в чат сам, без запиту з чату.
// Це результати задач за розкладом (deliver=webchat) і інструмент send_message. Приходять через плагін
// ~/.hermes/plugins/webchat → POST /api/hooks/hermes з ключем із data/.hermes-hook-token.
//
// Канал — рядок від Hermes: «schedule» (за замовчуванням) стає чатом «Розклад», будь-яка інша назва —
// окремим чатом з такою назвою; id наявного чату — сам цей чат.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment, Part } from '../src/shared.ts'
import { DATA_DIR, type MessageRow, createChat, getChat, getSetting, getUpload, insertMessage, listMessages, saveMessage, setSetting, updateChat } from './db.ts'
import { collectMedia } from './media.ts'
import { chatPrefs } from './prefs.ts'

const TOKEN_FILE = join(DATA_DIR, '.hermes-hook-token')
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
const TOKEN = Buffer.from(readFileSync(TOKEN_FILE, 'utf8').trim())

export function hookTokenOk(header: string | undefined): boolean {
  const got = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, '').trim())
  return got.length === TOKEN.length && timingSafeEqual(got, TOKEN)
}

const newId = () => randomBytes(9).toString('base64url')
const HOME = 'schedule'

/** Чат каналу, якщо він уже є (без створення): для прив'язки задач до чатів. */
export function findChannelChat(channel: string): string | null {
  const key = channel.trim() || HOME
  if (getChat(key)) return key
  const map = JSON.parse(getSetting('hermes_channels') ?? '{}') as Record<string, string>
  return map[key] && getChat(map[key]) ? map[key]! : null
}

/** Чат для каналу: наявний id чату, збережена відповідність або новий чат із назвою каналу. */
function channelChat(channel: string): string {
  const key = channel.trim() || HOME
  if (getChat(key)) return key
  const map = JSON.parse(getSetting('hermes_channels') ?? '{}') as Record<string, string>
  if (map[key] && getChat(map[key])) return map[key]
  const id = newId()
  createChat(id, '', null, 'native')
  updateChat(id, { title: key === HOME ? 'Розклад' : key.slice(0, 80), titleSource: 'user', mode: chatPrefs().defaultMode })
  map[key] = id
  setSetting('hermes_channels', JSON.stringify(map))
  return id
}

/** Окремий чат для задачі за розкладом: задача пише в нього за id (deliver=webchat:<id>). */
export function newJobChat(title: string): string {
  const id = newId()
  createChat(id, '', null, 'native')
  updateChat(id, { title: title.trim().slice(0, 80) || 'Задача', titleSource: 'user', mode: chatPrefs().defaultMode })
  return id
}

/** Hermes обгортає результат задачі в заголовок і підпис для месенджерів; у чаті показуємо це плашкою. */
function unwrapCron(text: string): { text: string; part: Extract<Part, { type: 'delivered' }> } {
  const m = /^Cronjob Response: (.+)\n\(job_id: ([^)]*)\)\n-+\n\n([\s\S]*?)(?:\n\nTo stop or manage this job, send me a new message[\s\S]*)?$/.exec(text)
  if (!m) return { text, part: { type: 'delivered', source: 'hermes' } }
  return { text: m[3]!.trim(), part: { type: 'delivered', source: 'cron', job: m[1]!.trim(), ...(m[2] ? { jobId: m[2] } : {}) } }
}

function filesFrom(paths: unknown): Attachment[] {
  if (!Array.isArray(paths) || !paths.length) return []
  // Та сама перевірка, що й для MEDIA: у відповідях: секрети не прикріпляться.
  return collectMedia(
    paths
      .filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
      .map((p) => `MEDIA:\`${p}\``)
      .join('\n'),
  ).attachments
}

export type Delivered = { message: MessageRow; created: boolean }

/**
 * Прийняти повідомлення від Hermes. Файли, що приходять окремими викликами одразу після тексту
 * (так Hermes шле вкладення в месенджери), чіпляються до того самого повідомлення.
 */
export function receiveFromHermes(body: { channel?: unknown; text?: unknown; media?: unknown }): Delivered {
  const chatId = channelChat(typeof body.channel === 'string' ? body.channel : '')
  const raw = typeof body.text === 'string' ? body.text.slice(0, 200_000) : ''
  const fromText = collectMedia(raw)
  const attachments = [...fromText.attachments, ...filesFrom(body.media)]
  const { text, part } = unwrapCron(fromText.text.trim())
  if (!text && !attachments.length) throw new Error('Порожнє повідомлення')

  const now = Date.now()
  if (!text) {
    const last = listMessages(chatId).at(-1)
    if (last && last.role === 'assistant' && last.parts.some((p) => p.type === 'delivered') && now - last.createdAt < 10 * 60_000) {
      last.attachments = [...last.attachments, ...attachments]
      saveMessage(last)
      updateChat(chatId, { touch: true })
      return { message: last, created: false }
    }
  }
  const message: MessageRow = {
    id: newId(),
    chatId,
    role: 'assistant',
    text,
    attachments,
    parts: [part],
    status: 'done',
    error: null,
    usage: null,
    model: null,
    createdAt: now,
    finishedAt: now,
    runId: null,
    lastSeq: -1,
  }
  insertMessage(message)
  updateChat(chatId, { touch: true })
  return { message, created: true }
}

/**
 * Hermes не бачить у своїй сесії того, що сам надіслав у чат ззовні (розклад, send_message).
 * Коли користувач відповідає, додаємо ці повідомлення до запиту, щоб Hermes розумів, про що мова.
 */
export function deliveredContext(chatId: string, before: number): string {
  const all = listMessages(chatId)
  const lastTurn = [...all].reverse().find((m) => m.role === 'user' && m.runId && m.createdAt < before)
  const fresh = all.filter(
    (m) => m.role === 'assistant' && m.createdAt < before && m.createdAt > (lastTurn?.createdAt ?? 0) && m.parts.some((p) => p.type === 'delivered'),
  )
  if (!fresh.length) return ''
  const fmt = new Intl.DateTimeFormat('uk', { dateStyle: 'short', timeStyle: 'short' })
  let budget = 12_000
  const blocks: string[] = []
  for (const m of fresh.slice(-5)) {
    const p = m.parts.find((x) => x.type === 'delivered') as Extract<Part, { type: 'delivered' }>
    const files = m.attachments
      .map((a) => getUpload(a.id))
      .filter((u) => u != null)
      .map((u) => `- ${u.path} (${u.name})`)
    const head = `${p.source === 'cron' ? `Результат задачі «${p.job ?? ''}»` : 'Повідомлення'}, ${fmt.format(m.createdAt)}:`
    const body = m.text.length > 4000 ? `${m.text.slice(0, 4000)}…` : m.text
    const block = [head, body, ...(files.length ? ['Файли:', ...files] : [])].join('\n')
    if (block.length > budget) break
    budget -= block.length
    blocks.push(block)
  }
  return blocks.length
    ? `[Раніше ти сам надіслав у цей чат (задача за розкладом чи send_message), у твоїй сесії цього немає. Користувач, імовірно, відповідає на це:]\n\n${blocks.join('\n\n---\n\n')}`
    : ''
}
