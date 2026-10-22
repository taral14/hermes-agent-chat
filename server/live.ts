// Живі відповіді Hermes: стан у пам'яті, збереження в SQLite і розсилка вкладкам.
// Події приносить native.ts (рідний протокол gateway); тут лише спільне ведення повідомлення до фіналу.
import type { Message, Part } from '../src/shared.ts'
import { type MessageRow, answersWithoutFiles, getChat, getMessage, listMessages, saveMessage, updateChat } from './db.ts'
import { chatPrefs } from './prefs.ts'
import { collectMedia } from './media.ts'
import { runFinished } from './push.ts'
import { sessionTitle } from './hermes.ts'

type Broadcast = (m: MessageRow) => void
type ChatChanged = (chatId: string) => void

let broadcast: Broadcast = () => {}
let chatChanged: ChatChanged = () => {}

export function setRunListeners(onMessage: Broadcast, onChat: ChatChanged) {
  broadcast = onMessage
  chatChanged = onChat
}

export type Live = { msg: MessageRow; dirty: boolean; flushTimer: NodeJS.Timeout | null }
const live = new Map<string, Live>()

/** Зареєструвати повідомлення, над яким зараз працює Hermes. */
export function openLive(msg: MessageRow): Live {
  const existing = live.get(msg.id)
  if (existing) return existing
  const l: Live = { msg, dirty: false, flushTimer: null }
  live.set(msg.id, l)
  return l
}

export const getLive = (id: string) => live.get(id)
export const liveMessages = () => [...live.values()]

/** Режим чату «Дозволяти все»: сервер сам відповідає на запити Hermes про дозвіл. */
export const autoApprove = (chatId: string) => getChat(chatId)?.mode === 'auto'

/** Зберегти і розіслати. Дельти тексту групуємо, решту подій шлемо одразу. */
export function flush(l: Live, now = false) {
  l.dirty = true
  if (now) {
    if (l.flushTimer) clearTimeout(l.flushTimer)
    l.flushTimer = null
    l.dirty = false
    saveMessage(l.msg)
    broadcast(l.msg)
    return
  }
  if (l.flushTimer) return
  l.flushTimer = setTimeout(() => {
    l.flushTimer = null
    if (!l.dirty) return
    l.dirty = false
    saveMessage(l.msg)
    broadcast(l.msg)
  }, 120)
}

/** Остання частина, якщо вона цього типу. Картки «до речі» не рахуються: вони не розривають потік тексту. */
export function lastPart<T extends Part['type']>(parts: Part[], type: T): Extract<Part, { type: T }> | undefined {
  const p = parts.findLast((x) => x.type !== 'btw')
  return p?.type === type ? (p as Extract<Part, { type: T }>) : undefined
}

/** Зберегти й розіслати вже завершене повідомлення (напр. відповідь «до речі», що прийшла після кінця задачі). */
export function publish(m: MessageRow) {
  const l = live.get(m.id)
  if (l) return flush(l, true)
  saveMessage(m)
  broadcast(m)
}

export function findPart<T extends Part['type']>(parts: Part[], type: T, match: (p: Extract<Part, { type: T }>) => boolean) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!
    if (p.type === type && match(p as Extract<Part, { type: T }>)) return p as Extract<Part, { type: T }>
  }
  return undefined
}

export function finish(l: Live, status: Message['status'], patch: { text?: string; error?: string | null } = {}) {
  const m = l.msg
  if (patch.text !== undefined) m.text = patch.text
  if (patch.error !== undefined) m.error = patch.error
  else if (status === 'done') m.error = null
  m.status = status
  m.finishedAt = Date.now()
  // Незавершені інструменти й запити на рішення більше не чекають.
  for (const p of m.parts) {
    if (p.type === 'tool' && p.status === 'running') p.status = status === 'done' ? 'done' : 'error'
    if ((p.type === 'approval' || p.type === 'clarify') && p.state === 'pending') p.state = 'settled'
    if (p.type === 'subagent' && p.status === 'running') p.status = 'error'
  }
  // Фінальна відповідь іде в text. Хвостові текстові шматки — це та сама відповідь у стрімі, прибираємо дубль.
  if (m.text) while (m.parts.length && m.parts[m.parts.length - 1]!.type === 'text') m.parts.pop()
  // Файли, які Hermes надіслав (MEDIA:/шлях), стають вкладеннями повідомлення.
  const media = collectMedia(m.text)
  if (media.attachments.length) {
    m.attachments = [...m.attachments, ...media.attachments]
    m.text = media.text
  }
  flush(l, true)
  updateChat(m.chatId, { touch: true })
  chatChanged(m.chatId)
  live.delete(m.id)
  void refreshTitle(m.chatId)
  runFinished(m)
}

/** Hermes сам придумує назву сесії після перших реплік; підтягуємо її, якщо користувач не перейменовував. */
export async function refreshTitle(chatId: string) {
  if (!chatPrefs().autoTitles) {
    // Автоназви вимкнено: назва — початок першого повідомлення, і більше не змінюється.
    const chat = getChat(chatId)
    if (!chat || chat.titleSource === 'user' || chat.title) return
    const first = listMessages(chatId).find((m) => m.role === 'user' && m.text.trim())
    if (!first) return
    const line = first.text.trim().split('\n')[0]!.replace(/\s+/g, ' ')
    updateChat(chatId, { title: line.length > 60 ? `${line.slice(0, 59)}…` : line, titleSource: 'text' })
    chatChanged(chatId)
    return
  }
  for (const delay of [1500, 8000, 25000]) {
    await new Promise((r) => setTimeout(r, delay))
    const chat = getChat(chatId)
    if (!chat || chat.titleSource === 'user') return
    const title = await sessionTitle(chat.sessionId)
    if (title && title !== chat.title) {
      updateChat(chatId, { title, titleSource: 'hermes' })
      chatChanged(chatId)
      return
    }
    if (title) return
  }
}

/** Актуальний стан повідомлення: з пам'яті, якщо воно ще виконується. */
export function liveMessage(id: string): MessageRow | null {
  return live.get(id)?.msg ?? getMessage(id)
}

/** Старі відповіді, де Hermes лишив шлях до файлу ще до підтримки вкладень. */
export function backfillMedia() {
  for (const m of answersWithoutFiles()) {
    const media = collectMedia(m.text)
    if (!media.attachments.length) continue
    m.attachments = media.attachments
    m.text = media.text
    saveMessage(m)
  }
}

export const activeRunCount = () => live.size

/** Чат видалено: його живі повідомлення більше ніхто не завершить, прибираємо їх з пам'яті. */
export function dropLive(chatId: string): string[] {
  const ids: string[] = []
  for (const l of live.values()) {
    if (l.msg.chatId !== chatId) continue
    if (l.flushTimer) clearTimeout(l.flushTimer)
    live.delete(l.msg.id)
    ids.push(l.msg.id)
  }
  return ids
}

export function stopAll() {
  for (const l of live.values()) {
    if (l.dirty) saveMessage(l.msg)
  }
}
