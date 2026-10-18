// Двигун чату на рідному протоколі Hermes gateway: ті самі сесії, що в TUI/Desktop, слеш-команди,
// перемотування історії (повтор/редагування), відгалуження, автоматизації (/goal, /loop, /heartbeat).
import { randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import type { Attachment, ChatControl, Message, ModelChoice, Part } from '../src/shared.ts'
import {
  type ChatRow,
  type MessageRow,
  activeMessages,
  createChat,
  deleteMessagesFrom,
  getChat,
  getChatBySession,
  getUpload,
  insertMessage,
  listMessages,
  saveMessage,
  updateChat,
} from './db.ts'
import { type GatewayEvent, GatewayError, type ServerRequest, gateway } from './gateway.ts'
import { defaultEffort } from './hermes.ts'
import { chatInstructions } from './prefs.ts'
import { promptRaised } from './push.ts'
import {
  type Live,
  autoApprove,
  findPart,
  finish,
  flush,
  getLive,
  lastPart,
  liveMessages,
  openLive,
  refreshTitle,
} from './runs.ts'

const IMAGE_STAGING = join(homedir(), '.hermes', 'cache', 'images')
const IMAGE_MIMES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const newId = () => randomBytes(9).toString('base64url')

type ChatChanged = (chatId: string) => void
let chatChanged: ChatChanged = () => {}

/** Покоління виконання кожного живого повідомлення: потрібне для зупинки, доповнення й відповідей. */
const generations = new Map<string, number>()
/** Повідомлення, що вже надіслане, але gateway ще не повернув admission_id (події можуть випередити відповідь). */
const awaiting = new Map<string, string>()

export class NativeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const REASONS: Record<string, string> = {
  session_busy: 'Hermes зараз зайнятий цією розмовою',
  unsupported_command: 'Ця команда не працює в такій сесії',
  permission_denied: 'Hermes не дозволив цю дію',
  revision_conflict: 'Розмова змінилась, спробуй ще раз',
  stale_generation: 'Розмова змінилась, спробуй ще раз',
  invalid_params: 'Hermes не прийняв запит',
  unavailable: 'Hermes gateway недоступний',
  timeout: 'Hermes не відповів вчасно',
}

function wrap(err: unknown): NativeError {
  if (err instanceof NativeError) return err
  if (err instanceof GatewayError) {
    const status = err.reason === 'session_busy' ? 409 : err.reason === 'unavailable' || err.reason === 'timeout' ? 503 : 400
    return new NativeError(status, REASONS[err.reason] ?? `Hermes: ${err.reason}`)
  }
  return new NativeError(500, (err as Error).message)
}

// ---------- Сесії ----------

/** Сесія Hermes для чату: створюємо при першому повідомленні, далі лише підписуємось. */
async function ensureSession(chat: ChatRow): Promise<string> {
  if (chat.sessionId) {
    await gateway.attach(chat.sessionId)
    return chat.sessionId
  }
  const created = await gateway.rpc<{ session_id: string }>('session.create', { request_id: `webchat-${chat.id}`, source: 'cli' })
  gateway.attached.add(created.session_id)
  updateChat(chat.id, { sessionId: created.session_id })
  return created.session_id
}

type Snapshot = {
  revision: number
  execution_generation: number
  running?: boolean
  messages?: { role?: string; content?: unknown; row_id?: number; message_id?: string; display_kind?: string }[]
}

async function snapshot(sessionId: string): Promise<Snapshot> {
  return (await gateway.attach(sessionId, true)) as unknown as Snapshot
}

/** Зміна сесії з ревізійним захистом. Якщо сесія щойно змінилась або зайнята, пробуємо ще раз. */
async function mutate(sessionId: string, operation: string, payload: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    const s = await snapshot(sessionId)
    try {
      return await gateway.rpc<Record<string, unknown>>('session.mutate', {
        session_id: sessionId,
        request_id: randomUUID(),
        expected_revision: s.revision,
        expected_generation: s.execution_generation,
        operation,
        payload,
      })
    } catch (err) {
      const retry = err instanceof GatewayError && ['revision_conflict', 'stale_generation', 'session_busy'].includes(err.reason)
      if (!retry || attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

// ---------- Надсилання ----------

function blankMessage(chatId: string, role: Message['role'], createdAt: number): MessageRow {
  return {
    id: newId(),
    chatId,
    role,
    text: '',
    attachments: [],
    parts: [],
    status: role === 'user' ? 'done' : 'queued',
    error: null,
    usage: null,
    model: null,
    createdAt,
    finishedAt: role === 'user' ? createdAt : null,
    runId: null,
    lastSeq: -1,
  }
}

/** Текст для моделі: інструкція чату + повідомлення + шляхи до прикріплених файлів. В історії лишається лише сам текст. */
function apiText(text: string, attachments: Attachment[]): string {
  const lines = attachments
    .map((a) => getUpload(a.id))
    .filter((u) => u != null)
    .map((u) => `- ${u.path} (${u.name}, ${u.mime}, ${Math.max(1, Math.round(u.size / 1024))} КБ)`)
  const files = lines.length
    ? `\n\n[Прикріплені файли. Вони збережені на цьому комп'ютері, відкривай їх своїми інструментами за потреби:]\n${lines.join('\n')}`
    : ''
  return `[${chatInstructions()}]\n\n${text || 'Подивись прикріплені файли.'}${files}`
}

/** Картинки Hermes бачить напряму, але бере їх лише зі своєї теки кешу. */
function stageImages(attachments: Attachment[]) {
  const staged: { path: string; mime: string }[] = []
  for (const a of attachments) {
    const u = getUpload(a.id)
    if (!u || !IMAGE_MIMES.has(u.mime) || staged.length >= 10) continue
    mkdirSync(IMAGE_STAGING, { recursive: true })
    const dest = join(IMAGE_STAGING, `webchat-${newId()}${extname(u.name) || '.png'}`)
    copyFileSync(u.path, dest)
    staged.push({ path: dest, mime: u.mime })
  }
  return staged
}

/** Зусилля, яке зараз стоїть у кожній сесії (щоб не міняти його без потреби). */
const appliedEffort = new Map<string, string>()

/** Зусилля чату → політика сесії Hermes (session.mutate reasoning). «Авто» повертає значення з налаштувань. */
async function applyEffort(sessionId: string, effort: string | undefined) {
  const want = effort || defaultEffort()
  if (appliedEffort.get(sessionId) === want) return
  if (!appliedEffort.has(sessionId) && !effort) {
    appliedEffort.set(sessionId, want) // нова сесія й так створена з налаштуваннями Hermes
    return
  }
  try {
    await mutate(sessionId, 'reasoning', { effort: want })
    appliedEffort.set(sessionId, want)
  } catch (err) {
    console.warn(`[native] не вдалося задати зусилля ${want}: ${(err as Error).message}`)
  }
}

async function submit(chat: ChatRow, assistant: MessageRow, user: MessageRow, text: string) {
  const sessionId = await ensureSession(chat)
  await applyEffort(sessionId, (chat.model as ModelChoice)?.effort)
  const images = stageImages(user.attachments)
  awaiting.set(chat.id, assistant.id)
  const model = chat.model as ModelChoice
  const receipt = await gateway.rpc<{ admission_id: string; execution_generation?: number | null }>('prompt.submit', {
    session_id: sessionId,
    submission_id: assistant.id,
    text,
    api_text: apiText(text, user.attachments),
    ...(images.length ? { attachments: images } : {}),
    ...(model?.model ? { model_override: { model: model.model, provider: model.provider } } : {}),
  })
  bind(assistant, user, receipt.admission_id)
}

function bind(assistant: MessageRow, user: MessageRow | null, admissionId: string) {
  const l = getLive(assistant.id) ?? openLive(assistant)
  if (!l.msg.runId) {
    l.msg.runId = admissionId
    if (l.msg.status === 'queued') l.msg.status = 'running'
    flush(l, true)
  }
  if (awaiting.get(assistant.chatId) === assistant.id) awaiting.delete(assistant.chatId)
  if (user && !user.runId) {
    user.runId = admissionId
    // Запуск користувача й рядок у Hermes мають один id: так знаходимо, що перемотувати.
    saveMessage(user)
  }
}

export type SendResult = { user: MessageRow; assistant: MessageRow }

/** Звичайне повідомлення в рідну сесію. */
export async function nativeSend(chat: ChatRow, text: string, attachments: Attachment[]): Promise<SendResult> {
  const now = Date.now()
  const user = { ...blankMessage(chat.id, 'user', now), text, attachments }
  const assistant = { ...blankMessage(chat.id, 'assistant', now + 1), model: chat.model?.model ?? null }
  insertMessage(user)
  insertMessage(assistant)
  updateChat(chat.id, { touch: true })
  openLive(assistant)
  try {
    await submit(chat, assistant, user, text)
  } catch (err) {
    awaiting.delete(chat.id)
    const l = getLive(assistant.id)
    if (l) finish(l, 'error', { error: wrap(err).message })
  }
  return { user, assistant }
}

/** Слеш-команда: або одразу відповідь (/status), або Hermes повертає текст, який треба надіслати (/goal, /plan, навички). */
export async function nativeCommand(chat: ChatRow, command: string, display?: string): Promise<SendResult> {
  const now = Date.now()
  const user = { ...blankMessage(chat.id, 'user', now), text: display ?? command }
  const assistant = blankMessage(chat.id, 'assistant', now + 1)
  insertMessage(user)
  insertMessage(assistant)
  updateChat(chat.id, { touch: true })
  const l = openLive(assistant)
  try {
    const sessionId = await ensureSession(chat)
    const r = await gateway.rpc<{ type: string; output?: string; message?: string; display?: string; notice?: string }>(
      'slash.exec',
      { session_id: sessionId, command },
      120_000,
    )
    if (r.type === 'send' && r.message) {
      if (r.notice) l.msg.parts.push({ type: 'notice', text: r.notice })
      flush(l, true)
      await submit(getChat(chat.id)!, assistant, user, r.message)
    } else {
      finish(l, 'done', { text: str(r.output) || 'Готово.' })
    }
  } catch (err) {
    awaiting.delete(chat.id)
    if (getLive(assistant.id)) finish(l, 'error', { error: wrap(err).message })
  }
  return { user, assistant }
}

/** Повтор або редагування: перемотуємо історію Hermes до цього повідомлення й надсилаємо знову. */
export async function nativeRewind(chat: ChatRow, userMessageId: string, newText?: string): Promise<SendResult> {
  if (chat.running) throw new NativeError(409, 'Спершу зупини поточну задачу')
  const msgs = listMessages(chat.id)
  const user = msgs.find((m) => m.id === userMessageId && m.role === 'user')
  if (!user?.runId) throw new NativeError(400, 'Це повідомлення не можна повторити')
  try {
    const snap = await snapshot(chat.sessionId)
    const row = snap.messages?.find((r) => r.role === 'user' && r.message_id === user.runId)
    if (!row?.row_id) throw new NativeError(400, 'Hermes уже не має цього повідомлення в історії')
    await gateway.rpc('session.mutate', {
      session_id: chat.sessionId,
      request_id: randomUUID(),
      expected_revision: snap.revision,
      expected_generation: snap.execution_generation,
      operation: 'rewind',
      payload: { target_message_id: row.row_id },
    })
  } catch (err) {
    throw wrap(err)
  }
  deleteMessagesFrom(chat.id, user.createdAt)
  const text = newText?.trim() || user.text
  const fresh = getChat(chat.id)!
  // Повтор ходу, що почався з команди (/goal, /plan…), знову йде як команда.
  return text.startsWith('/') && !user.attachments.length ? nativeCommand(fresh, text) : nativeSend(fresh, text, user.attachments)
}

/** Нова гілка розмови до цієї відповіді включно. Повертає id нового чату. */
export async function nativeBranch(chat: ChatRow, assistantMessageId: string): Promise<string> {
  const msgs = listMessages(chat.id)
  const idx = msgs.findIndex((m) => m.id === assistantMessageId)
  if (idx < 0) throw new NativeError(404, 'Повідомлення не знайдено')
  const keep = msgs.slice(0, idx + 1)
  const lastUser = [...keep].reverse().find((m) => m.role === 'user' && m.runId)
  try {
    const snap = await snapshot(chat.sessionId)
    const rows = snap.messages ?? []
    let through: number | undefined
    if (lastUser) {
      const start = rows.findIndex((r) => r.role === 'user' && r.message_id === lastUser.runId)
      if (start >= 0) {
        let end = start + 1
        while (end < rows.length && !(rows[end]!.role === 'user' && !rows[end]!.display_kind)) end++
        through = rows[end - 1]?.row_id
      }
    }
    const title = `${chat.title || 'Розмова'} · гілка`
    const r = await mutate(chat.sessionId, 'branch', { title, ...(through ? { through_message_id: through } : {}) })
    const child = str(r.branched_session_id)
    if (!child) throw new NativeError(500, 'Hermes не створив гілку')
    const id = newId()
    createChat(id, child, chat.model, 'native')
    updateChat(id, { title, titleSource: 'user' })
    for (const m of keep) {
      insertMessage({ ...m, id: newId(), chatId: id })
    }
    gateway.attached.add(child)
    return id
  } catch (err) {
    throw wrap(err)
  }
}

/** Чат перемкнули на «Дозволяти все»: відповідаємо на запити, які вже чекають. */
export function approvePending(chat: ChatRow) {
  for (const l of liveMessages()) {
    if (l.msg.chatId !== chat.id) continue
    for (const p of l.msg.parts) {
      if (p.type !== 'approval' || p.state !== 'pending') continue
      const choice = 'once'
      gateway
        .rpc('approval.respond', { session_id: chat.sessionId, execution_generation: p.generation, prompt_id: p.promptId, choice })
        .then(() => {
          p.state = 'answered'
          p.choice = choice
          p.auto = true
          flush(l, true)
        })
        .catch(() => {})
    }
  }
}

/** Службова команда без повідомлень у чаті (кнопки панелі мети): /goal pause|resume|clear тощо. */
export async function nativeControl(chat: ChatRow, command: string): Promise<string> {
  try {
    const sessionId = await ensureSession(chat)
    const r = await gateway.rpc<{ type: string; output?: string; notice?: string }>('slash.exec', { session_id: sessionId, command }, 60_000)
    return str(r.output ?? r.notice)
  } catch (err) {
    throw wrap(err)
  }
}

export async function nativeRename(chat: ChatRow, title: string) {
  if (!chat.sessionId) return
  await mutate(chat.sessionId, 'rename', { title }).catch(() => {})
}

export async function nativeDelete(chat: ChatRow) {
  if (!chat.sessionId) return
  await mutate(chat.sessionId, 'delete', {}).catch((err) => console.warn(`[native] видалення сесії: ${(err as Error).message}`))
}

// ---------- Керування запуском ----------

function liveFor(messageId: string): { l: Live; chat: ChatRow; gen: number | undefined } {
  const l = getLive(messageId)
  if (!l) throw new NativeError(409, 'Задача вже завершена')
  const chat = getChat(l.msg.chatId)
  if (!chat) throw new NativeError(404, 'Чат не знайдено')
  return { l, chat, gen: generations.get(messageId) }
}

export async function nativeStop(messageId: string) {
  const { chat, gen } = liveFor(messageId)
  try {
    await gateway.rpc('session.interrupt', { session_id: chat.sessionId, ...(gen != null ? { execution_generation: gen } : {}) })
  } catch (err) {
    throw wrap(err)
  }
}

export async function nativeSteer(messageId: string, text: string) {
  const { l, chat, gen } = liveFor(messageId)
  try {
    await gateway.rpc('session.steer', { session_id: chat.sessionId, execution_generation: gen ?? 1, text })
  } catch (err) {
    throw wrap(err)
  }
  l.msg.parts.push({ type: 'steer', text })
  flush(l, true)
}

export async function nativeAnswer(messageId: string, kind: 'approval' | 'clarify', promptId: string, generation: number, value: string) {
  const { l, chat } = liveFor(messageId)
  try {
    if (kind === 'approval') {
      await gateway.rpc('approval.respond', { session_id: chat.sessionId, execution_generation: generation, prompt_id: promptId, choice: value })
    } else {
      await gateway.rpc('clarify.respond', { session_id: chat.sessionId, execution_generation: generation, prompt_id: promptId, answer: value })
    }
  } catch (err) {
    throw wrap(err)
  }
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

// ---------- Події ----------

const OPENERS = new Set(['message.start', 'agent.step', 'message.delta', 'thinking.delta', 'tool.start', 'message.interim', 'message.complete'])

function liveForEvent(chat: ChatRow, e: GatewayEvent): Live | null {
  const adm = e.admission_id
  if (!adm) return null
  for (const l of liveMessages()) if (l.msg.chatId === chat.id && l.msg.runId === adm) return l
  // Наша відправка, на яку gateway ще не відповів квитанцією.
  const waiting = awaiting.get(chat.id)
  if (waiting) {
    const l = getLive(waiting)
    if (l && !l.msg.runId) {
      const user = [...listMessages(chat.id)].reverse().find((m) => m.role === 'user' && !m.runId) ?? null
      bind(l.msg, user, adm)
      return l
    }
  }
  if (!OPENERS.has(e.type)) return null
  // Пізня подія вже завершеного ходу — не створюємо дубль.
  if (listMessages(chat.id).some((m) => m.runId === adm)) return null
  // Хід, який Hermes почав сам: продовження /goal, /loop, /heartbeat, завершення фонової задачі.
  const msg = { ...blankMessage(chat.id, 'assistant', Date.now()), runId: adm, status: 'running' as const }
  insertMessage(msg)
  updateChat(chat.id, { touch: true })
  chatChanged(chat.id)
  return openLive(msg)
}

function apply(l: Live, e: GatewayEvent) {
  const m = l.msg
  const p = (e.payload ?? {}) as Record<string, unknown>
  if (typeof e.execution_generation === 'number') generations.set(m.id, e.execution_generation)
  if (typeof e.sequence === 'number') {
    if (e.sequence <= m.lastSeq) return
    m.lastSeq = e.sequence
  }
  const parts = m.parts
  switch (e.type) {
    case 'message.start':
    case 'agent.step':
      if (m.status === 'queued') {
        m.status = 'running'
        flush(l, true)
      }
      return
    case 'message.delta': {
      const delta = str(p.text)
      if (!delta) return
      if (m.status === 'queued') m.status = 'running'
      const t = lastPart(parts, 'text')
      if (t) t.text += delta
      else parts.push({ type: 'text', text: delta.replace(/^\s+/, '') })
      return flush(l)
    }
    case 'thinking.delta':
      // Це анімація TUI («(⊙_⊙) processing...»), а не міркування моделі. Показуємо лише статус «Працює».
      return
    case 'message.interim': {
      if (p.already_streamed) return
      const text = str(p.text).trim()
      if (text) parts.push({ type: 'text', text })
      return flush(l, true)
    }
    case 'tool.start':
      parts.push({
        type: 'tool',
        id: str(p.tool_id ?? p.tool_call_id) || `t${parts.length}`,
        tool: str(p.tool_name ?? p.name),
        preview: str(p.context),
        status: 'running',
      })
      return flush(l, true)
    case 'tool.progress':
    case 'tool.generating': {
      const t = findPart(parts, 'tool', (x) => x.id === str(p.tool_id ?? p.tool_call_id))
      if (t && p.context) t.preview = str(p.context)
      return flush(l)
    }
    case 'tool.complete': {
      const t = findPart(parts, 'tool', (x) => x.id === str(p.tool_id ?? p.tool_call_id))
      if (t) {
        t.status = p.is_error ? 'error' : 'done'
        if (typeof p.duration === 'number') t.duration = p.duration
        const result = p.result ?? p.summary
        if (result != null) t.result = str(typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 600)
      }
      return flush(l, true)
    }
    case 'approval.request': {
      const promptId = str(p.prompt_id)
      if (findPart(parts, 'approval', (x) => x.promptId === promptId)) return
      const a: Extract<Part, { type: 'approval' }> = {
        type: 'approval',
        promptId,
        generation: Number(p.execution_generation ?? e.execution_generation ?? 0),
        command: str(p.command),
        description: str(p.description),
        choices: Array.isArray(p.choices) ? p.choices.map(str) : ['once', 'deny'],
        state: 'pending',
      }
      parts.push(a)
      if (autoApprove(m.chatId)) {
        // Лише на цю команду: якщо потім перемкнути режим на «Питати», Hermes знову питатиме.
        const choice = 'once'
        a.state = 'answered'
        a.choice = choice
        a.auto = true
        const chat = getChat(m.chatId)!
        gateway
          .rpc('approval.respond', { session_id: chat.sessionId, execution_generation: a.generation, prompt_id: a.promptId, choice })
          .catch((err: Error) => {
            console.warn(`[native] автодозвіл не пройшов: ${err.message}`)
            a.state = 'pending'
            a.auto = false
            a.choice = undefined
            flush(l, true)
            promptRaised(m, a)
          })
      } else promptRaised(m, a)
      return flush(l, true)
    }
    case 'clarify.request': {
      const promptId = str(p.prompt_id)
      if (findPart(parts, 'clarify', (x) => x.promptId === promptId)) return
      const c: Extract<Part, { type: 'clarify' }> = {
        type: 'clarify',
        promptId,
        generation: Number(p.execution_generation ?? e.execution_generation ?? 0),
        question: str(p.question),
        choices: Array.isArray(p.choices) ? p.choices.map(str) : [],
        multi: Boolean(p.multi_select),
        state: 'pending',
      }
      parts.push(c)
      promptRaised(m, c)
      return flush(l, true)
    }
    case 'approval.settled':
    case 'clarify.settled': {
      const kind = e.type.startsWith('approval') ? 'approval' : 'clarify'
      for (const x of parts) if (x.type === kind && x.promptId === str(p.prompt_id) && x.state === 'pending') x.state = 'settled'
      return flush(l, true)
    }
    case 'subagent.start':
    case 'subagent.spawn':
      parts.push({
        type: 'subagent',
        id: str(p.subagent_id ?? p.child_session_id ?? p.id) || `s${parts.length}`,
        goal: str(p.goal ?? p.task ?? p.title),
        status: 'running',
      })
      return flush(l, true)
    case 'subagent.complete':
    case 'subagent.done': {
      const id = str(p.subagent_id ?? p.child_session_id ?? p.id)
      const s = findPart(parts, 'subagent', (x) => x.id === id) ?? findPart(parts, 'subagent', (x) => x.status === 'running')
      if (s) {
        s.status = /fail|error|timeout/i.test(str(p.status)) ? 'error' : 'done'
        if (p.summary) s.summary = str(p.summary)
      }
      return flush(l, true)
    }
    case 'message.complete': {
      const usage = p.usage as { input?: number; output?: number; total?: number; model?: string } | undefined
      if (usage) {
        m.usage = { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.total }
        if (usage.model) m.model = usage.model
      }
      const text = str(p.text ?? p.content)
      const outcome = str(p.outcome || p.status)
      generations.delete(m.id)
      if (/interrupt|cancel/.test(outcome)) return finish(l, 'cancelled', { text })
      if (/fail|error/.test(outcome)) return finish(l, 'error', { text, error: str(p.error) || 'Hermes завершив задачу з помилкою.' })
      return finish(l, 'done', { text: text || streamed(m) })
    }
  }
}

function streamed(m: MessageRow) {
  const tail: string[] = []
  for (let i = m.parts.length - 1; i >= 0 && m.parts[i]!.type === 'text'; i--) tail.unshift((m.parts[i] as { text: string }).text)
  return tail.join('\n\n').trim()
}

function onEvent(e: GatewayEvent) {
  if (!e.session_id) return
  const chat = getChatBySession(e.session_id)
  if (!chat) return
  if (e.type === 'session.control.update') {
    const control = ((e.payload ?? {}) as { control?: ChatControl }).control ?? null
    updateChat(chat.id, { control })
    chatChanged(chat.id)
    return
  }
  const l = liveForEvent(chat, e)
  if (l) apply(l, e)
}

function onRequest(r: ServerRequest) {
  // Дозволи й уточнення в локальних сесіях приходять подіями; інші запити (sudo, секрети) чат не обробляє.
  gateway.respond(r.id, null, { code: -32601, message: 'not supported by web chat' })
}

/** Після (пере)підключення: підписуємось на сесії з незавершеними задачами й звіряємо їхній стан. */
async function onConnected() {
  const sessions = new Set<string>()
  for (const l of liveMessages()) {
    const chat = getChat(l.msg.chatId)
    if (chat?.engine === 'native' && chat.sessionId) sessions.add(chat.sessionId)
  }
  for (const sid of sessions) {
    try {
      const snap = (await gateway.attach(sid, true)) as unknown as Snapshot & { pending?: { admission_id?: string }[] }
      if (snap.running) continue
      const queued = new Set((snap.pending ?? []).map((x) => x.admission_id))
      // Задача завершилась, поки нас не було: беремо фінальну відповідь з історії Hermes.
      const chat = getChatBySession(sid)!
      // Лише ходи, які gateway уже прийняв і не тримає в черзі; щойно надіслані ще не мають runId.
      for (const l of liveMessages().filter((x) => x.msg.chatId === chat.id && x.msg.runId && !queued.has(x.msg.runId))) {
        const rows = snap.messages ?? []
        const start = rows.findIndex((r) => r.role === 'user' && r.message_id === l.msg.runId)
        const after = start >= 0 ? rows.slice(start + 1) : []
        const answer = [...after].reverse().find((r) => r.role === 'assistant' && typeof r.content === 'string' && r.content.trim())
        if (answer) finish(l, 'done', { text: str(answer.content) })
        else finish(l, 'interrupted', { text: streamed(l.msg), error: 'Зв’язок із Hermes обірвався, результат невідомий.' })
      }
    } catch (err) {
      console.warn(`[native] не вдалося відновити ${sid}: ${(err as Error).message}`)
    }
  }
}

export function initNative(onChat: ChatChanged) {
  chatChanged = onChat
  gateway.on({ event: onEvent, request: onRequest, connected: () => void onConnected() })
  // Незавершені задачі рідних чатів після перезапуску сервера: реєструємо, міст підпишеться й звірить стан.
  let pending = false
  for (const m of activeMessages()) {
    const chat = getChat(m.chatId)
    if (chat?.engine !== 'native') continue
    openLive(m)
    pending = true
  }
  if (pending) gateway.start()
}

export { refreshTitle }

// ---------- Каталог команд ----------

/** Команди, що працюють у веб-чаті, з поясненням українською. Порядок = порядок у меню. */
const COMMANDS: [string, string, string?][] = [
  ['goal', 'Поставити мету: Hermes працює сам, доки не досягне', '<мета>'],
  ['subgoal', 'Додати критерій до поточної мети', '<критерій>'],
  ['plan', 'Скласти план без виконання', '<задача>'],
  ['review', 'Незалежна перевірка щойно зробленого'],
  ['moa', 'Запитати кілька моделей разом і звести відповідь', '<питання>'],
  ['loop', 'Повторювати запит у цьому чаті за інтервалом', '<інтервал> <запит>'],
  ['heartbeat', 'Повертатися до чату, коли він простоює', '<інтервал> <запит>'],
  ['learn', 'Навчитися нової навички з опису, сайту чи цієї розмови', '<що>'],
  ['refine', 'Зберегти уроки цієї розмови в пам’ять і навички'],
  ['blueprint', 'Налаштувати автоматизацію з шаблону'],
  ['status', 'Стан сесії: модель, контекст, токени'],
  ['usage', 'Використання токенів і ліміти'],
  ['context', 'Наскільки заповнений контекст'],
  ['memory', 'Пам’ять: записи на погодження'],
  ['skills', 'Встановлені навички'],
  ['personality', 'Особистість Hermes', '<назва>'],
  ['reasoning', 'Глибина міркувань', '<low|medium|high>'],
  ['fast', 'Швидкий режим моделі', '<on|off>'],
  ['insights', 'Аналітика використання'],
  ['suggestions', 'Запропоновані автоматизації'],
  ['diff', 'Зміни git у робочій папці'],
  ['title', 'Перейменувати сесію', '<назва>'],
  ['help', 'Довідка по командах'],
]

/** Вбудовані команди Hermes, які в чаті не працюють або мають свою кнопку. Решта невідомих — навички. */
const CORE = new Set(
  ('start new topic clear redraw history save retry prompt undo handoff branch worktree compress rollback snapshot export import stop pause ' +
    'approve deny bg btw agents journey queue steer status egress context whoami profile sethome resume sessions config model codex-runtime ' +
    'personality statusbar battery timestamps diff verbose focus footer yolo approvals reasoning fast skin indicator voice wake busy autoprune ' +
    'tools toolsets skills memory bundles pet hatch learn init cron suggestions blueprint curator kanban reload-mcp reload-skills commands help ' +
    'restart usage login topup insights platform update version debug platforms quit exit goal subgoal loop heartbeat plan moa review refine title ' +
    'reload browser plugins palette subscription copy paste image density logs mouse theme terminal').split(' '),
)

export type CommandInfo = { name: string; description: string; hint?: string; skill?: boolean }
let catalogCache: { at: number; value: CommandInfo[] } | null = null

export async function commandCatalog(): Promise<CommandInfo[]> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.value
  const r = await gateway.rpc<{ pairs?: [string, string][] }>('commands.catalog', {})
  const skills: CommandInfo[] = []
  for (const [raw, desc] of r.pairs ?? []) {
    const name = raw.replace(/^\//, '').split(/\s/)[0]!
    if (!name || CORE.has(name)) continue
    skills.push({ name, description: desc.replace(/\s*\(usage:[^)]*\)\s*$/, ''), skill: true })
  }
  const value = [...COMMANDS.map(([name, description, hint]) => ({ name, description, ...(hint ? { hint } : {}) })), ...skills]
  catalogCache = { at: Date.now(), value }
  return value
}
