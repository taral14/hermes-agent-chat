// Спільний доступ лише для перегляду: посилання /s/<токен>, знімок розмови без ходу роботи Hermes.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { answerUrls, findUrls } from '../../src/links.ts'
import type { LinkPreview, ShareInfo, ShareListItem, SharedChat } from '../../src/shared.ts'
import { PUBLIC_URL } from '../config.ts'
import { type ShareRow, deleteShare, getChat, getShare, getShareByChat, getUpload, listMessages, listShares, upsertShare } from '../db.ts'
import { type Ctx, HttpError, escHtml, send } from '../http.ts'
import { cachedPreview, unfurl } from '../unfurl.ts'
import { serveFile } from './files.ts'

const ACTIVE = new Set(['queued', 'running', 'stopping'])
const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' }

/** Повідомлення, що потрапляють у посилання: до моменту `upto`, завершені й не порожні. */
function sharedMessages(share: ShareRow) {
  return listMessages(share.chatId).filter((m) => m.createdAt <= share.upto && !ACTIVE.has(m.status) && (m.text.trim() || m.attachments.length))
}

function shareInfo(share: ShareRow): ShareInfo {
  const all = listMessages(share.chatId).filter((m) => m.text.trim() || m.attachments.length)
  const count = all.filter((m) => m.createdAt <= share.upto).length
  return { ...share, url: `${PUBLIC_URL}/s/${share.token}`, count, newer: all.length - count }
}

/** Посилання, для яких повідомлення показує картки: у питаннях — до трьох, у відповідях — відео й джерела. */
function linkTargets(m: { role: string; text: string }): string[] {
  if (m.role === 'user') return findUrls(m.text.replace(/^(>.*\n?)+/, ''))
  const a = answerUrls(m.text)
  return [...a.videos, ...a.links]
}

/**
 * Знімок для глядача: лише текст і вкладення. Хід роботи Hermes (команди, шляхи, результати інструментів)
 * не показуємо, а великі файли, що лежать на сервері без копії, лишаються тільки назвою.
 */
function sharedChat(share: ShareRow): SharedChat | null {
  const chat = getChat(share.chatId)
  if (!chat) return null
  const previews: Record<string, LinkPreview> = {}
  const messages = sharedMessages(share).map((m) => {
    for (const u of linkTargets(m)) previews[u] ??= cachedPreview(u) ?? { url: u, kind: 'link', failed: true }
    return {
      id: m.id,
      role: m.role,
      text: m.text,
      attachments: m.attachments.map((a) => (a.ref ? { id: '', name: a.name, mime: a.mime, size: a.size, ref: true } : a)),
      createdAt: m.createdAt,
      model: m.model,
    }
  })
  return { title: chat.title || 'Чат з Hermes', sharedAt: share.updatedAt, messages, previews }
}

/** Мета-теги сторінки /s/<токен>: назва для прев'ю в месенджерах і заборона індексації. */
export function sharePageMeta(token: string): string {
  const s = getShare(token)
  const title = s ? getChat(s.chatId)?.title || 'Чат з Hermes' : 'Посилання недійсне'
  return (
    `<title>${escHtml(title)} · Hermes</title>` +
    `<meta property="og:title" content="${escHtml(title)}" />` +
    `<meta property="og:description" content="Діалог з Hermes · лише перегляд" />` +
    `<meta property="og:site_name" content="Hermes" />` +
    `<meta name="robots" content="noindex, nofollow" />`
  )
}

/** Публічні маршрути: працюють без входу. */
export function publicShareRoutes({ req, res, url, path, method }: Ctx): boolean {
  const m = /^\/api\/public\/share\/([\w-]{20,})(?:\/file\/([\w-]+))?$/.exec(path)
  if (!m || (method !== 'GET' && method !== 'HEAD')) return false
  const share = getShare(m[1]!)
  if (!share) return send(res, 404, { error: 'Посилання недійсне або власник його видалив' }, NOINDEX)
  if (!m[2]) {
    const data = sharedChat(share)
    return data ? send(res, 200, data, NOINDEX) : send(res, 404, { error: 'Чат видалено' }, NOINDEX)
  }
  // Файл віддаємо, лише якщо він прикріплений до повідомлення з посилання і скопійований у чат.
  const fileId = m[2]
  const allowed = sharedMessages(share).some((x) => x.attachments.some((a) => a.id === fileId && !a.ref))
  const u = allowed ? getUpload(fileId) : null
  if (!u || !existsSync(u.path)) return send(res, 404, { error: 'Файл недоступний' }, NOINDEX)
  return serveFile(req, res, u, url.searchParams.has('download'))
}

/** Керування посиланнями власником. */
export function shareRoutes({ res, path, method }: Ctx): boolean {
  if (path === '/api/shares' && method === 'GET') {
    const list: ShareListItem[] = listShares().map((x) => ({
      chatId: x.chatId,
      title: getChat(x.chatId)?.title || 'Без назви',
      url: `${PUBLIC_URL}/s/${x.token}`,
      updatedAt: x.updatedAt,
    }))
    return send(res, 200, list)
  }
  const sh = path.match(/^\/api\/chats\/([\w-]+)\/share$/)
  if (!sh) return false
  const chat = getChat(sh[1]!)
  if (!chat) throw new HttpError(404, 'Чат не знайдено')
  if (method === 'GET') {
    const share = getShareByChat(chat.id)
    return send(res, 200, { share: share ? shareInfo(share) : null })
  }
  if (method === 'POST') {
    const prev = getShareByChat(chat.id)
    const share = upsertShare(chat.id, prev?.token ?? randomBytes(18).toString('base64url'), Date.now())
    // Підтягнути картки посилань заздалегідь: глядач бачить лише те, що вже в кеші.
    for (const m of sharedMessages(share)) for (const u of linkTargets(m)) void unfurl(u).catch(() => {})
    return send(res, 200, { share: shareInfo(share) })
  }
  if (method === 'DELETE') {
    deleteShare(chat.id)
    return send(res, 200, { share: null })
  }
  return false
}
