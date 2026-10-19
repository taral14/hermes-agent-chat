// HTTP-утиліти, спільні для всіх маршрутів: відповіді, читання тіла, захист від чужих сторінок.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Контекст запиту, який отримує кожна група маршрутів. */
export type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; path: string; method: string }
/** Група маршрутів: true — запит оброблено, false — не її. */
export type Routes = (c: Ctx) => Promise<boolean> | boolean

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(data)
  return true
}

/** Потік файлу у відповідь. Помилка читання (файл зник, немає доступу) не кладе сервер, а обриває відповідь. */
export function stream(src: Readable, res: ServerResponse): true {
  pipeline(src, res).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn(`[file] ${err.message}`)
    if (!res.headersSent) send(res, 500, { error: 'Не вдалося прочитати файл' })
    else res.destroy()
  })
  return true
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, `Файл завеликий (до ${Math.round(limit / 1024 / 1024)} МБ)`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req, 1024 * 1024)
  // Лише справжній JSON: звичайна HTML-форма з чужої сторінки не може поставити цей тип без дозволу CORS.
  if (buf.length && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
    throw new HttpError(415, 'Потрібен Content-Type: application/json')
  }
  try {
    return (buf.length ? JSON.parse(buf.toString('utf8')) : {}) as T
  } catch {
    throw new HttpError(400, 'Некоректний JSON')
  }
}

/**
 * Захист від підробки запитів (CSRF). Сусідні сайти на тому самому домені браузер вважає «тим самим сайтом»
 * і шле їм нашу cookie, тому SameSite=Lax тут не рятує. Змінювати щось можна лише зі сторінки самого чату.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true // не браузер (curl, роутер): cookie сам не підставить
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/

/**
 * Адреса клієнта. Заголовкам проксі віримо, лише коли з'єднання прийшло з цього ж комп'ютера (тунель, Caddy):
 * інакше будь-хто підставить собі нову «адресу» і обійде ліміт спроб входу.
 */
export function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? ''
  if (!LOOPBACK.test(direct)) return direct
  return String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? direct).split(',')[0]!.trim()
}

export const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Заголовки для сторінки й статики: без чужих скриптів, без вбудовування у фрейм. */
export const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Файли користувача й Hermes не можуть виконувати скрипти на нашому домені (SVG, HTML тощо). */
export const SANDBOX_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
