// Hermes пише в чат сам (плагін webchat): результати задач за розкладом і send_message.
import { publicMessage } from '../db.ts'
import { emit, emitChat, syncJobLinks } from '../events.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { hookTokenOk, receiveFromHermes } from '../inbox.ts'
import { hermesDelivered } from '../push.ts'

export async function hookRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path !== '/api/hooks/hermes' || method !== 'POST') return false
  // Лише з цього комп'ютера (не через тунель), з ключем із data/.hermes-hook-token.
  if (req.headers['cf-connecting-ip']) throw new HttpError(404, 'Невідомий маршрут')
  if (!hookTokenOk(req.headers.authorization)) throw new HttpError(401, 'Неправильний ключ')
  const body = await readJson<Parameters<typeof receiveFromHermes>[0]>(req)
  let r
  try {
    r = receiveFromHermes(body)
  } catch (err) {
    throw new HttpError(400, (err as Error).message)
  }
  emit({ type: 'message', message: publicMessage(r.message) })
  emitChat(r.message.chatId)
  if (r.created) hermesDelivered(r.message)
  syncJobLinks()
  return send(res, 200, { ok: true, message_id: r.message.id, chat_id: r.message.chatId })
}
