// Файли: завантаження від користувача, віддача з підтримкою Range, тимчасові посилання на великі файли.
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Attachment } from '../../src/shared.ts'
import { UPLOAD_DIR, type UploadRow, createDownloadLink, getUpload, insertUpload, resolveDownloadLink } from '../db.ts'
import { type Ctx, HttpError, SANDBOX_CSP, readBody, send, stream } from '../http.ts'
import { mimeOf } from '../media.ts'
import { newId } from '../util.ts'

const MAX_UPLOAD = 25 * 1024 * 1024
const LINK_TTL = 60 * 60_000

/**
 * Файл частинами (Range): аудіо й відео в Safari, докачування великих файлів. Великі файли — це оригінали на
 * сервері, вони читаються потоком без копіювання.
 */
export function serveFile(req: IncomingMessage, res: ServerResponse, u: UploadRow, forceDownload: boolean, privateCache = true): true {
  let size: number
  try {
    const st = statSync(u.path)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    return send(res, 410, { error: 'Файл переміщено або видалено з сервера' })
  }
  const inline = /^(image|audio|video)\//.test(u.mime) || u.mime === 'application/pdf' || u.mime.startsWith('text/plain')
  const download = forceDownload || !inline
  const headers: Record<string, string> = {
    'Content-Type': u.mime === 'text/plain' ? 'text/plain; charset=utf-8' : u.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': privateCache ? 'private, max-age=31536000, immutable' : 'no-store',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(u.name)}`,
    'X-Content-Type-Options': 'nosniff',
  }
  // PDF лишаємо без sandbox, інакше браузер не відкриє свій переглядач.
  if (u.mime !== 'application/pdf') headers['Content-Security-Policy'] = SANDBOX_CSP
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return true
    }
    start = Math.max(0, start)
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
    return stream(createReadStream(u.path, { start, end }), res)
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(size) })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  return stream(createReadStream(u.path), res)
}

/** /dl/<токен>/<назва> — тимчасове посилання без входу: завантаження великого файлу з сервера. */
export function serveDownloadLink(req: IncomingMessage, res: ServerResponse, token: string) {
  const u = resolveDownloadLink(token)
  if (!u || !existsSync(u.path)) {
    res.writeHead(u ? 410 : 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(u ? 'Файл переміщено або видалено з сервера.' : 'Посилання недійсне або його термін минув.')
    return
  }
  serveFile(req, res, u, true, false)
}

export async function fileRoutes({ req, res, url, path, method }: Ctx): Promise<boolean> {
  if (path === '/api/uploads' && method === 'POST') {
    let name: string
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'))
    } catch {
      name = 'file'
    }
    name = name.replace(/[/\\\0]/g, '_').slice(0, 180) || 'file'
    const sent = String(req.headers['content-type'] ?? '').split(';')[0]!.trim()
    const mime = sent && sent !== 'application/octet-stream' ? sent : mimeOf(name)
    const data = await readBody(req, MAX_UPLOAD)
    if (!data.length) throw new HttpError(400, 'Порожній файл')
    const id = newId()
    const dir = join(UPLOAD_DIR, id)
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, data)
    const a: Attachment = { id, name, mime, size: data.length }
    insertUpload({ ...a, path: file })
    return send(res, 200, a)
  }

  let m = path.match(/^\/api\/uploads\/([\w-]+)\/link$/)
  if (m && method === 'POST') {
    const u = getUpload(m[1]!)
    if (!u) throw new HttpError(404, 'Файл не знайдено')
    if (!existsSync(u.path)) throw new HttpError(410, 'Файл переміщено або видалено з сервера')
    const token = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + LINK_TTL
    createDownloadLink(token, u.id, expiresAt)
    return send(res, 200, { url: `/dl/${token}/${encodeURIComponent(u.name)}`, expiresAt })
  }

  m = path.match(/^\/api\/uploads\/([\w-]+)$/)
  if (m && (method === 'GET' || method === 'HEAD')) {
    const u = getUpload(m[1]!)
    if (!u) throw new HttpError(404, 'Файл не знайдено')
    return serveFile(req, res, u, url.searchParams.has('download'))
  }
  return false
}
