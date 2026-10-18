// Ведення запусків Hermes: сервер сам слухає події, зберігає їх у SQLite і розсилає вкладкам.
// Тому довга задача не залежить від відкритого браузера, а після перезапуску сервера підхоплюється знову.
import type { Message, Part } from '../src/shared.ts'
import { type MessageRow, activeMessages, answersWithoutFiles, getChat, getMessage, saveMessage, updateChat } from './db.ts'
import { collectMedia } from './media.ts'
import {
  type HermesEvent,
  HermesError,
  getRun,
  lastAssistantText,
  sessionTitle,
  streamRunEvents,
} from './hermes.ts'

type Broadcast = (m: MessageRow) => void
type ChatChanged = (chatId: string) => void

let broadcast: Broadcast = () => {}
let chatChanged: ChatChanged = () => {}

export function setRunListeners(onMessage: Broadcast, onChat: ChatChanged) {
  broadcast = onMessage
  chatChanged = onChat
}

type Live = { msg: MessageRow; abort: AbortController; dirty: boolean; flushTimer: NodeJS.Timeout | null }
const live = new Map<string, Live>()

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Зберегти і розіслати. Дельти тексту групуємо, решту подій шлемо одразу. */
function flush(l: Live, now = false) {
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

function lastPart<T extends Part['type']>(parts: Part[], type: T): Extract<Part, { type: T }> | undefined {
  const p = parts[parts.length - 1]
  return p?.type === type ? (p as Extract<Part, { type: T }>) : undefined
}

function findPart<T extends Part['type']>(parts: Part[], type: T, match: (p: Extract<Part, { type: T }>) => boolean) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!
    if (p.type === type && match(p as Extract<Part, { type: T }>)) return p as Extract<Part, { type: T }>
  }
  return undefined
}

function finish(l: Live, status: Message['status'], patch: { text?: string; error?: string | null } = {}) {
  const m = l.msg
  if (patch.text !== undefined) m.text = patch.text
  if (patch.error !== undefined) m.error = patch.error
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
  l.abort.abort()
  live.delete(m.id)
  void refreshTitle(m.chatId)
}

/** Hermes сам придумує назву сесії після перших реплік; підтягуємо її, якщо користувач не перейменовував. */
async function refreshTitle(chatId: string) {
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

function apply(l: Live, e: HermesEvent) {
  const m = l.msg
  if (typeof e.seq === 'number') {
    if (e.seq <= m.lastSeq) return
    m.lastSeq = e.seq
  }
  const parts = m.parts
  switch (e.event) {
    case 'run.queued':
      m.status = 'queued'
      return flush(l, true)
    case 'run.started':
    case 'message.started':
      if (m.status === 'queued') m.status = 'running'
      return flush(l, true)
    case 'message.delta': {
      const delta = str(e.delta)
      if (!delta) return
      if (m.status === 'queued') m.status = 'running'
      const t = lastPart(parts, 'text')
      if (t) t.text += delta
      else parts.push({ type: 'text', text: delta.replace(/^\s+/, '') })
      return flush(l)
    }
    case 'message.interim': {
      if (e.already_streamed) return
      const text = str(e.text).trim()
      if (text) parts.push({ type: 'text', text })
      return flush(l, true)
    }
    case 'reasoning.available': {
      const text = str(e.text).trim()
      if (!text) return
      const r = lastPart(parts, 'reasoning')
      if (r) r.text = text
      else parts.push({ type: 'reasoning', text })
      return flush(l)
    }
    case 'tool.started':
      parts.push({
        type: 'tool',
        id: str(e.tool_call_id) || `t${parts.length}`,
        tool: str(e.tool),
        preview: str(e.preview),
        status: 'running',
      })
      return flush(l, true)
    case 'tool.progress': {
      const t = findPart(parts, 'tool', (p) => p.id === str(e.tool_call_id) || (!e.tool_call_id && p.status === 'running'))
      if (t && e.preview) t.preview = str(e.preview)
      return flush(l)
    }
    case 'tool.completed':
    case 'tool.failed': {
      const t = findPart(parts, 'tool', (p) => p.id === str(e.tool_call_id)) ??
        findPart(parts, 'tool', (p) => p.status === 'running' && p.tool === str(e.tool))
      if (t) {
        t.status = e.event === 'tool.failed' || e.error ? 'error' : 'done'
        if (typeof e.duration === 'number') t.duration = e.duration
        if (e.preview) t.result = str(e.preview)
      }
      return flush(l, true)
    }
    case 'approval.request': {
      const promptId = str(e.prompt_id)
      if (findPart(parts, 'approval', (p) => p.promptId === promptId)) return
      parts.push({
        type: 'approval',
        promptId,
        generation: Number(e.execution_generation ?? 0),
        command: str(e.command),
        description: str(e.description),
        choices: Array.isArray(e.choices) ? e.choices.map(str) : ['once', 'deny'],
        state: 'pending',
      })
      return flush(l, true)
    }
    case 'approval.responded':
    case 'approval.settled': {
      const a = findPart(parts, 'approval', (p) => p.promptId === str(e.prompt_id ?? e.request_id))
      if (a) {
        if (a.state === 'pending') a.state = 'settled'
        if (e.choice) a.choice = str(e.choice)
      }
      return flush(l, true)
    }
    case 'clarify.request': {
      const promptId = str(e.prompt_id)
      if (findPart(parts, 'clarify', (p) => p.promptId === promptId)) return
      parts.push({
        type: 'clarify',
        promptId,
        generation: Number(e.execution_generation ?? 0),
        question: str(e.question),
        choices: Array.isArray(e.choices) ? e.choices.map(str) : [],
        multi: Boolean(e.multi_select),
        state: 'pending',
      })
      return flush(l, true)
    }
    case 'clarify.settled': {
      const c = findPart(parts, 'clarify', (p) => p.promptId === str(e.prompt_id))
      if (c && c.state === 'pending') c.state = 'settled'
      return flush(l, true)
    }
    case 'subagent.start':
      parts.push({
        type: 'subagent',
        id: str(e.subagent_id ?? e.child_session_id ?? e.delegation_id) || `s${parts.length}`,
        goal: str(e.goal ?? e.task ?? e.preview),
        status: 'running',
      })
      return flush(l, true)
    case 'subagent.complete': {
      const id = str(e.subagent_id ?? e.child_session_id ?? e.delegation_id)
      const s = findPart(parts, 'subagent', (p) => p.id === id) ?? findPart(parts, 'subagent', (p) => p.status === 'running')
      if (s) {
        s.status = /fail|error|timeout/i.test(str(e.status)) ? 'error' : 'done'
        if (e.summary) s.summary = str(e.summary)
        if (typeof e.duration === 'number') s.duration = e.duration
      }
      return flush(l, true)
    }
    case 'run.steered': {
      const text = str(e.text ?? e.input ?? e.message).trim()
      if (text && !findPart(parts, 'steer', (p) => p.text === text)) parts.push({ type: 'steer', text })
      return flush(l, true)
    }
    case 'run.stopping':
      m.status = 'stopping'
      return flush(l, true)
    case 'run.completed': {
      m.usage = (e.usage as Message['usage']) ?? null
      const runtime = e.runtime as { model?: string } | undefined
      if (runtime?.model) m.model = runtime.model
      const output = str(e.output)
      if (e.partial || e.completed === false) {
        return finish(l, 'error', { text: output, error: 'Hermes не завершив задачу повністю (ліміт кроків або обрив).' })
      }
      return finish(l, 'done', { text: output || streamedAnswer(m) })
    }
    case 'run.failed':
      return finish(l, 'error', { text: streamedAnswer(m), error: str(e.error) || 'Запуск завершився з помилкою.' })
    case 'run.cancelled':
      return finish(l, 'cancelled', { text: streamedAnswer(m) })
    case 'run.interrupted':
      return finish(l, 'interrupted', { text: streamedAnswer(m), error: str(e.error) || 'Hermes перезапустився під час задачі.' })
  }
}

/** Текст після останнього інструмента — відповідь, що встигла настрімитись. */
function streamedAnswer(m: MessageRow): string {
  const tail: string[] = []
  for (let i = m.parts.length - 1; i >= 0 && m.parts[i]!.type === 'text'; i--) tail.unshift((m.parts[i] as { text: string }).text)
  return tail.join('\n\n').trim()
}

/** Коли потік подій закрився без фіналу: дізнаємось стан у Hermes. Повертає true, якщо запуск завершено. */
async function reconcile(l: Live): Promise<boolean> {
  const m = l.msg
  try {
    const s = await getRun(m.runId!)
    if (!TERMINAL.has(s.status)) return false
    if (s.status === 'completed') finish(l, 'done', { text: s.output || streamedAnswer(m) })
    else if (s.status === 'cancelled') finish(l, 'cancelled', { text: s.output || streamedAnswer(m) })
    else finish(l, s.status === 'interrupted' ? 'interrupted' : 'error', { text: s.output || streamedAnswer(m), error: s.error || 'Запуск не завершився.' })
    return true
  } catch (err) {
    if (err instanceof HermesError && err.status === 404) {
      // Hermes уже забув цей запуск (статуси живуть недовго). Беремо відповідь з історії сесії.
      const chat = getChat(m.chatId)
      const text = chat ? await lastAssistantText(chat.sessionId) : null
      if (text) finish(l, 'done', { text })
      else finish(l, 'interrupted', { text: streamedAnswer(m), error: 'Зв’язок із запуском втрачено, результат невідомий.' })
      return true
    }
    return false
  }
}

async function follow(l: Live) {
  let backoff = 1000
  while (live.get(l.msg.id) === l && !l.abort.signal.aborted) {
    try {
      await streamRunEvents(l.msg.runId!, l.msg.lastSeq, (e) => apply(l, e), l.abort.signal)
      backoff = 1000
    } catch (err) {
      if (l.abort.signal.aborted) return
      if (err instanceof HermesError && err.status === 404 && (await reconcile(l))) return
      console.warn(`[run ${l.msg.runId}] потік подій: ${(err as Error).message}`)
    }
    if (live.get(l.msg.id) !== l) return
    if (await reconcile(l)) return
    await new Promise((r) => setTimeout(r, backoff))
    backoff = Math.min(backoff * 2, 15_000)
  }
}

export function track(msg: MessageRow) {
  if (live.has(msg.id) || !msg.runId) return
  const l: Live = { msg, abort: new AbortController(), dirty: false, flushTimer: null }
  live.set(msg.id, l)
  void follow(l)
}

/** Актуальний стан повідомлення: з пам'яті, якщо воно ще виконується. */
export function liveMessage(id: string): MessageRow | null {
  return live.get(id)?.msg ?? getMessage(id)
}

export function failMessage(msg: MessageRow, error: string) {
  const l: Live = live.get(msg.id) ?? { msg, abort: new AbortController(), dirty: false, flushTimer: null }
  live.set(msg.id, l)
  finish(l, 'error', { error })
}

/** Позначити, що користувач відповів на запит, не чекаючи події від Hermes. */
export function markAnswered(messageId: string, promptId: string, value: string) {
  const l = live.get(messageId)
  if (!l) return
  for (const p of l.msg.parts) {
    if (p.type === 'approval' && p.promptId === promptId) {
      p.state = 'answered'
      p.choice = value
    }
    if (p.type === 'clarify' && p.promptId === promptId) {
      p.state = 'answered'
      p.answer = value
    }
  }
  flush(l, true)
}

export function addSteer(messageId: string, text: string) {
  const l = live.get(messageId)
  if (!l) return
  l.msg.parts.push({ type: 'steer', text })
  flush(l, true)
}

export function resumeActiveRuns() {
  for (const m of activeMessages()) {
    if (m.runId) track(m)
    else failMessage(m, 'Задачу не вдалося передати Hermes.')
  }
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

export function stopAll() {
  for (const l of live.values()) {
    if (l.dirty) saveMessage(l.msg)
    l.abort.abort()
  }
}
