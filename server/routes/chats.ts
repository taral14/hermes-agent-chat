// Чати, списки й повідомлення: надсилання, керування ходом Hermes, повтор, редагування, гілки.
import type { Attachment, ChatMode, ModelChoice } from '../../src/shared.ts'
import {
  type ChatRow,
  createChat,
  createList,
  deleteChat,
  deleteList,
  getChat,
  getMessage,
  getUpload,
  listChats,
  listLists,
  listMessages,
  markRead,
  publicMessage,
  updateChat,
  updateList,
} from '../db.ts'
import { emit, emitChat, publicChat } from '../events.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { liveMessage } from '../live.ts'
import { sweepUploads } from '../media.ts'
import {
  NativeError,
  approvePending,
  forgetChat,
  nativeAnswer,
  nativeBranch,
  nativeBtw,
  nativeCommand,
  nativeControl,
  nativeDelete,
  nativeRename,
  nativeRewind,
  nativeSend,
  nativeSteer,
  nativeStop,
} from '../native.ts'
import { setMuted } from '../push.ts'
import { newId } from '../util.ts'

const isMode = (v: unknown): v is ChatMode => v === 'ask' || v === 'auto' || v === 'plan'
const LEGACY = 'Цей чат створено старою версією чату: його можна читати, а продовжити розмову — у новому чаті'

function shortTitle(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t
}

/** Помилки рідного протоколу — у HTTP-статуси. */
async function native<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof NativeError) throw new HttpError(err.status, err.message)
    throw err
  }
}

const chatView = (chat: ChatRow) => ({
  chat: publicChat(getChat(chat.id) ?? chat),
  messages: listMessages(chat.id).map((x) => publicMessage(liveMessage(x.id) ?? x)),
})

async function sendMessage(body: { chatId?: string; text?: string; attachments?: string[]; model?: ModelChoice; mode?: string; listId?: string }) {
  const text = String(body.text ?? '').trim()
  const attachments: Attachment[] = (body.attachments ?? [])
    .map((id) => getUpload(String(id)))
    .filter((u) => u != null)
    .map(({ path: _p, ...a }) => a)
  if (!text && !attachments.length) throw new HttpError(400, 'Порожнє повідомлення')

  let chat = body.chatId ? getChat(body.chatId) : null
  if (body.chatId && !chat) throw new HttpError(404, 'Чат не знайдено')
  if (chat && chat.engine !== 'native') throw new HttpError(410, LEGACY)
  if (!chat) {
    // Сесія Hermes створиться при відправці.
    const id = newId()
    chat = createChat(id, '', body.model ?? null, 'native')
    updateChat(id, {
      title: shortTitle(text || attachments[0]!.name),
      titleSource: 'auto',
      ...(isMode(body.mode) ? { mode: body.mode } : {}),
      ...(body.listId && listLists().some((l) => l.id === body.listId) ? { listId: body.listId } : {}),
    })
  } else if (body.model !== undefined) {
    updateChat(chat.id, { model: body.model })
  }
  if (chat.running) throw new HttpError(409, 'Hermes ще працює над попередньою задачею')
  chat = getChat(chat.id)!

  emitChat(chat.id)
  const r =
    text.startsWith('/') && !attachments.length
      ? await nativeCommand(chat, text)
      : chat.mode === 'plan' && !attachments.length
        ? await nativeCommand(chat, `/plan ${text}`, text) // «Лише план»: Hermes складає план і нічого не виконує
        : await nativeSend(chat, text, attachments)
  emitChat(chat.id)
  return {
    chat: publicChat(getChat(chat.id)!),
    messages: [publicMessage(r.user), publicMessage(liveMessage(r.assistant.id) ?? r.assistant)],
  }
}

/** Видалити чат повністю: зупинити роботу Hermes, прибрати файли, сесію Hermes і посилання. */
async function removeChat(chat: ChatRow) {
  const messages = listMessages(chat.id)
  if (chat.engine === 'native') {
    for (const msg of messages) {
      const l = liveMessage(msg.id)
      if (l?.runId && ['queued', 'running', 'stopping'].includes(l.status)) await nativeStop(l.id).catch(() => {})
    }
    forgetChat(chat.id)
  }
  // Вкладення цього чату, які більше ніде не використовуються, видаляємо одразу.
  const attached = new Set(messages.flatMap((x) => x.attachments.map((a) => a.id)))
  deleteChat(chat.id)
  if (attached.size) sweepUploads(0, attached)
  if (chat.engine === 'native') void nativeDelete(chat)
  emit({ type: 'chat-deleted', chatId: chat.id })
}

export async function chatRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path === '/api/chats' && method === 'GET') return send(res, 200, listChats().map(publicChat))
  if (path === '/api/messages' && method === 'POST') return send(res, 200, await sendMessage(await readJson(req)))

  // Видалити всі чати. Потрібне підтвердження словом, щоб випадковий запит нічого не стер.
  if (path === '/api/chats/delete-all' && method === 'POST') {
    const b = await readJson<{ confirm?: string }>(req)
    if (b.confirm !== 'видалити') throw new HttpError(400, 'Потрібне підтвердження')
    const all = listChats()
    for (const c of all) await removeChat(c)
    return send(res, 200, { deleted: all.length })
  }

  // ---------- Списки чатів ----------
  if (path === '/api/lists' && method === 'GET') return send(res, 200, listLists())
  if (path === '/api/lists' && method === 'POST') {
    const { name } = await readJson<{ name?: string }>(req)
    if (!name?.trim()) throw new HttpError(400, 'Дай списку назву')
    const list = createList(newId(), name.trim().slice(0, 60))
    emit({ type: 'lists', lists: listLists() })
    return send(res, 200, list)
  }
  const lm = path.match(/^\/api\/lists\/([\w-]+)$/)
  if (lm && method === 'PATCH') {
    const b = await readJson<{ name?: string; color?: string }>(req)
    updateList(lm[1]!, { ...(b.name?.trim() ? { name: b.name.trim().slice(0, 60) } : {}), ...(b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? { color: b.color } : {}) })
    emit({ type: 'lists', lists: listLists() })
    return send(res, 200, listLists())
  }
  if (lm && method === 'DELETE') {
    deleteList(lm[1]!)
    emit({ type: 'lists', lists: listLists() })
    for (const c of listChats()) emitChat(c.id)
    return send(res, 200, { ok: true })
  }

  let m = path.match(/^\/api\/chats\/([\w-]+)$/)
  if (m) {
    const chat = getChat(m[1]!)
    if (!chat) throw new HttpError(404, 'Чат не знайдено')
    if (method === 'GET') return send(res, 200, chatView(chat))
    if (method === 'PATCH') {
      const b = await readJson<{ title?: string; pinned?: boolean; model?: ModelChoice; mode?: string; listId?: string | null; muted?: boolean }>(req)
      if (typeof b.muted === 'boolean') setMuted(chat.id, b.muted)
      if (typeof b.title === 'string' && b.title.trim()) {
        const title = b.title.trim().slice(0, 120)
        updateChat(chat.id, { title, titleSource: 'user' })
        if (chat.engine === 'native') void nativeRename(chat, title)
      }
      if (typeof b.pinned === 'boolean') updateChat(chat.id, { pinned: b.pinned })
      if (b.listId === null || (typeof b.listId === 'string' && listLists().some((l) => l.id === b.listId))) updateChat(chat.id, { listId: b.listId })
      if (b.model !== undefined) updateChat(chat.id, { model: b.model })
      if (isMode(b.mode)) {
        updateChat(chat.id, { mode: b.mode })
        if (b.mode === 'auto' && chat.engine === 'native') approvePending(getChat(chat.id)!)
      }
      emitChat(chat.id)
      return send(res, 200, publicChat(getChat(chat.id)!))
    }
    if (method === 'DELETE') {
      await removeChat(chat)
      return send(res, 200, { ok: true })
    }
    return false
  }

  // Повтор, редагування й відгалуження.
  m = path.match(/^\/api\/messages\/([\w-]+)\/(retry|edit|branch)$/)
  if (m && method === 'POST') {
    const target = getMessage(m[1]!)
    const chat = target ? getChat(target.chatId) : null
    if (!target || !chat) throw new HttpError(404, 'Повідомлення не знайдено')
    if (chat.engine !== 'native') throw new HttpError(410, LEGACY)
    const action = m[2]
    if (action === 'branch') {
      const id = await native(() => nativeBranch(chat, target.id))
      emitChat(id)
      return send(res, 200, { chatId: id })
    }
    let userId = target.id
    if (target.role === 'assistant') {
      const msgs = listMessages(chat.id)
      const idx = msgs.findIndex((x) => x.id === target.id)
      const prev = msgs.slice(0, idx).reverse().find((x) => x.role === 'user')
      if (!prev) throw new HttpError(400, 'Немає повідомлення, яке можна повторити')
      userId = prev.id
    }
    const b = action === 'edit' ? await readJson<{ text?: string }>(req) : {}
    if (action === 'edit' && !b.text?.trim()) throw new HttpError(400, 'Порожній текст')
    await native(() => nativeRewind(chat, userId, b.text))
    emitChat(chat.id)
    return send(res, 200, chatView(chat))
  }

  m = path.match(/^\/api\/chats\/([\w-]+)\/read$/)
  if (m && method === 'POST') {
    if (!getChat(m[1]!)) throw new HttpError(404, 'Чат не знайдено')
    // Інші пристрої теж знімуть позначку.
    if (markRead(m[1]!)) emitChat(m[1]!)
    return send(res, 200, { ok: true })
  }

  m = path.match(/^\/api\/chats\/([\w-]+)\/control$/)
  if (m && method === 'POST') {
    const chat = getChat(m[1]!)
    if (!chat || chat.engine !== 'native') throw new HttpError(404, 'Чат не знайдено')
    const { command } = await readJson<{ command?: string }>(req)
    // Лише керування автоматизаціями сесії, без довільних команд.
    if (!command || !/^\/(goal|loop|heartbeat)( (pause|resume|clear|stop|off|status))?$/.test(command.trim())) throw new HttpError(400, 'Невідома дія')
    return send(res, 200, { output: await native(() => nativeControl(chat, command.trim())) })
  }

  // Керування ходом, що триває: зупинити, доповнити, відповісти на запит дозволу чи уточнення.
  m = path.match(/^\/api\/messages\/([\w-]+)\/(stop|steer|btw|approval|clarify)$/)
  if (m && method === 'POST') {
    const id = m[1]!
    const action = m[2]!
    const msg = liveMessage(id)
    if (!msg) throw new HttpError(404, 'Повідомлення не знайдено')
    if (getChat(msg.chatId)?.engine !== 'native') throw new HttpError(410, LEGACY)
    if (action === 'stop') await native(() => nativeStop(id))
    else if (action === 'steer' || action === 'btw') {
      const { text } = await readJson<{ text?: string }>(req)
      if (!text?.trim()) throw new HttpError(400, 'Порожній текст')
      await native(() => (action === 'btw' ? nativeBtw(id, text.trim()) : nativeSteer(id, text.trim())))
    } else {
      const b = await readJson<{ promptId?: string; generation?: number; value?: string }>(req)
      if (!b.promptId || typeof b.value !== 'string') throw new HttpError(400, 'Немає відповіді')
      await native(() => nativeAnswer(id, action as 'approval' | 'clarify', b.promptId!, Number(b.generation ?? 0), b.value!))
    }
    return send(res, 200, { ok: true })
  }
  return false
}
