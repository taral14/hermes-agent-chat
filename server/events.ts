// Події для відкритих вкладок (SSE): нові повідомлення, зміни чатів, списків і бази знань.
import type { ServerResponse } from 'node:http'
import type { Chat, ServerEvent } from '../src/shared.ts'
import { type ChatRow, getChat, publicChat as rawPublicChat } from './db.ts'
import type { Ctx } from './http.ts'
import { jobsForChat, refreshJobLinks } from './jobLinks.ts'
import { isMuted } from './push.ts'

const clients = new Set<ServerResponse>()

export function emit(e: ServerEvent) {
  const data = `data: ${JSON.stringify(e)}\n\n`
  for (const c of clients) c.write(data)
}

/** Чат для клієнта: разом із задачами за розкладом, що доставляють у нього результати, і тихим режимом. */
export function publicChat(c: ChatRow): Chat {
  const jobs = jobsForChat(c.id)
  return { ...rawPublicChat(c), ...(jobs.length ? { jobs } : {}), ...(isMuted(c.id) ? { muted: true } : {}) }
}

export function emitChat(chatId: string) {
  const chat = getChat(chatId)
  if (chat) emit({ type: 'chat', chat: publicChat(chat) })
}

/** Перечитати прив'язку задач до чатів і оновити в клієнтів чати, де вона змінилась. */
export function syncJobLinks() {
  void refreshJobLinks().then((changed) => {
    for (const id of changed) emitChat(id)
  })
}

export function eventsRoute({ req, res, path }: Ctx): boolean {
  if (path !== '/api/events') return false
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': open\n\n')
  clients.add(res)
  req.on('close', () => clients.delete(res))
  return true
}

setInterval(() => {
  for (const c of clients) c.write(': ping\n\n')
}, 20_000).unref()

export function closeEvents() {
  for (const c of clients) c.end()
}
