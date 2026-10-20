// Сервер чату: статика, маршрути API і фонові задачі. Самі маршрути — у server/routes/.
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer, request as httpRequest } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { BIND_HOST, PORT, PUBLIC_HOST, PUBLIC_URL, ROOT, ROUTER_URL } from './config.ts'
import { closeDb, publicMessage } from './db.ts'
import { closeEvents, emit, emitChat, eventsRoute, syncJobLinks } from './events.ts'
import { gateway } from './gateway.ts'
import { type Ctx, HttpError, PAGE_HEADERS, type Routes, sameOrigin, send } from './http.ts'
import { activeRunCount, backfillMedia, setRunListeners, stopAll } from './live.ts'
import { sweepUploads } from './media.ts'
import { initNative, onCronChanged } from './native.ts'
import { accountRoutes, loginRoutes } from './routes/auth.ts'
import { chatRoutes } from './routes/chats.ts'
import { fileRoutes, serveDownloadLink } from './routes/files.ts'
import { hookRoutes } from './routes/hooks.ts'
import { jobRoutes } from './routes/jobs.ts'
import { extensionRoutes, pluginReturnRoute, pluginRoutes, skillRoutes } from './routes/plugins.ts'
import { kbRoutes } from './routes/kb.ts'
import { pushRoutes } from './routes/push.ts'
import { settingsRoutes } from './routes/settings.ts'
import { publicShareRoutes, sharePageMeta, shareRoutes } from './routes/share.ts'
import { authed, loadConfig } from './session.ts'
import { watchVault } from './vault.ts'

const DEV = process.env.NODE_ENV !== 'production'
const DIST = join(ROOT, 'dist')

// ---------- API ----------

/** Пінг для роутера: тримає сервер живим, поки Hermes працює (див. keepAlive нижче). */
const ping: Routes = ({ res, path }) => {
  if (path !== '/api/ping') return false
  res.writeHead(204, { 'Cache-Control': 'no-store' })
  res.end()
  return true
}

/** Без входу: вхід, публічні посилання, хук Hermes. */
const PUBLIC: Routes[] = [loginRoutes, ping, publicShareRoutes, hookRoutes, pluginReturnRoute]
/** Лише після входу. */
const PRIVATE: Routes[] = [accountRoutes, eventsRoute, pushRoutes, settingsRoutes, shareRoutes, chatRoutes, kbRoutes, fileRoutes, jobRoutes, pluginRoutes, extensionRoutes, skillRoutes]

async function api(c: Ctx) {
  if (c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS' && !sameOrigin(c.req)) {
    throw new HttpError(403, 'Запит з іншого сайту відхилено')
  }
  for (const r of PUBLIC) if (await r(c)) return
  if (!authed(c.req)) throw new HttpError(401, 'Потрібен вхід')
  for (const r of PRIVATE) if (await r(c)) return
  throw new HttpError(404, 'Невідомий маршрут')
}

// ---------- Сторінка й статика ----------

const EXT_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // Воркер PDF.js.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
}

let page: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void

if (DEV) {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' })
  page = (req, res) => vite.middlewares(req, res)
} else {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('Немає dist/index.html: спершу зберіть інтерфейс (npm run build)')
  const index = (await readFile(join(DIST, 'index.html'))).toString('utf8')
  page = async (_req, res, url) => {
    const file = normalize(join(DIST, decodeURIComponent(url.pathname)))
    if (file.startsWith(DIST + sep) && extname(file) && statSync(file, { throwIfNoEntry: false })?.isFile()) {
      const immutable = url.pathname.startsWith('/assets/')
      res.writeHead(200, {
        'Content-Type': EXT_MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...PAGE_HEADERS,
      })
      res.end(await readFile(file))
      return
    }
    const share = /^\/s\/([\w-]{20,})\/?$/.exec(url.pathname)
    if (share) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...PAGE_HEADERS })
      res.end(index.replace('<title>Hermes</title>', sharePageMeta(share[1]!)))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...PAGE_HEADERS })
    res.end(index)
  }
}

// ---------- Сервер ----------

function fail(res: ServerResponse, err: unknown) {
  // Кривий URL (%E0 тощо) — помилка клієнта, а не сервера.
  const badUrl = err instanceof URIError || (err as NodeJS.ErrnoException).code === 'ERR_INVALID_URL'
  const status = err instanceof HttpError ? err.status : badUrl ? 400 : 500
  if (status === 500) console.error(err)
  if (!res.headersSent) send(res, status, { error: badUrl ? 'Некоректна адреса' : (err as Error).message })
  else res.end()
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const dl = /^\/dl\/([\w-]{20,})(?:\/|$)/.exec(url.pathname)
    if (dl && (req.method === 'GET' || req.method === 'HEAD')) return serveDownloadLink(req, res, dl[1]!)
    if (!url.pathname.startsWith('/api/')) return await page(req, res, url)
    await api({ req, res, url, path: url.pathname, method: req.method ?? 'GET' })
  } catch (err) {
    fail(res, err)
  }
})

// Помилка в якомусь фоновому обробнику не має класти чат для всіх: пишемо в журнал і працюємо далі.
process.on('unhandledRejection', (err) => console.error('[unhandled]', err))

// Роутер (якщо чат запущено за ним) зупиняє сервер після простою. Поки Hermes працює над задачею, стукаємо до себе
// через роутер, щоб не пропустити подію і пуш. Без роутера це не потрібно. Результати розкладу Hermes приносить сам
// (плагін webchat) — роутер підніме чат на цей запит.
if (!DEV && ROUTER_URL) {
  setInterval(() => {
    if (!activeRunCount()) return
    const r = httpRequest(`${ROUTER_URL}/api/ping`, { headers: { Host: PUBLIC_HOST }, timeout: 10_000 }, (res) => res.resume())
    r.on('error', () => {})
    r.on('timeout', () => r.destroy())
    r.end()
  }, 5 * 60_000).unref()
}

loadConfig()
setRunListeners((m) => emit({ type: 'message', message: publicMessage(m) }), emitChat)
initNative(emitChat)
onCronChanged(syncJobLinks)
syncJobLinks()
setInterval(syncJobLinks, 2 * 60_000).unref()
backfillMedia()
sweepUploads()
setInterval(() => sweepUploads(), 6 * 3600_000).unref()

server.listen(PORT, BIND_HOST, () => {
  console.log(`chat: http://${BIND_HOST}:${PORT}${DEV ? ' (dev)' : ''} → ${PUBLIC_URL}`)
  // Сховище читаємо вже після старту: доступ до iCloud Drive не має затримувати сервер.
  void watchVault((paths) => emit({ type: 'kb', paths }))
})

function shutdown() {
  stopAll()
  gateway.stop()
  closeEvents()
  server.close()
  closeDb()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
