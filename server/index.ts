import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Attachment, ModelChoice, ServerEvent } from '../src/shared.ts'
import {
  DATA_DIR,
  type MessageRow,
  UPLOAD_DIR,
  closeDb,
  createChat,
  deleteChat,
  getChat,
  getUpload,
  insertMessage,
  insertUpload,
  listChats,
  listMessages,
  publicChat,
  publicMessage,
  updateChat,
} from './db.ts'
import {
  HermesError,
  type InputContent,
  answerApproval,
  answerClarify,
  deleteSession,
  modelOptions,
  renameSession,
  startRun,
  steerRun,
  stopRun,
} from './hermes.ts'
import {
  addSteer,
  failMessage,
  liveMessage,
  markAnswered,
  resumeActiveRuns,
  setRunListeners,
  stopAll,
  track,
} from './runs.ts'

const PORT = Number(process.env.PORT ?? 5190)
const DEV = process.env.NODE_ENV !== 'production'
const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const MAX_UPLOAD = 25 * 1024 * 1024
const MAX_INLINE_IMAGE = 8 * 1024 * 1024
const SESSION_DAYS = 90

// ---------- Конфіг і сесії ----------

type Config = { username: string; password: string }

/** Логін і пароль єдиного користувача — у config.yaml поруч із package.json (не в git). */
function loadConfig(): Config {
  const file = join(ROOT, 'config.yaml')
  if (!existsSync(file)) throw new Error(`Немає ${file}: створи його з полями username і password`)
  const c = parseYaml(readFileSync(file, 'utf8')) as Partial<Config> | null
  if (!c?.username || !c?.password) throw new Error('config.yaml: потрібні username і password')
  return { username: String(c.username), password: String(c.password) }
}

const SECRET_FILE = join(DATA_DIR, '.session-secret')
if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
const SECRET = readFileSync(SECRET_FILE, 'utf8').trim()

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url')

function sessionCookie(): string {
  const exp = Date.now() + SESSION_DAYS * 86400_000
  // Пароль входить у підпис: зміна пароля в config.yaml розлогінює всі пристрої.
  const payload = `${exp}`
  return `${payload}.${sign(payload + '|' + loadConfig().password)}`
}

function authed(req: IncomingMessage): boolean {
  const raw = req.headers.cookie?.match(/(?:^|;\s*)chat_session=([^;]+)/)?.[1]
  if (!raw) return false
  const [exp, mac] = raw.split('.')
  if (!exp || !mac || Number(exp) < Date.now()) return false
  const expected = Buffer.from(sign(exp + '|' + loadConfig().password))
  const got = Buffer.from(mac)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

function same(a: string, b: string) {
  const x = createHmac('sha256', SECRET).update(a).digest()
  const y = createHmac('sha256', SECRET).update(b).digest()
  return timingSafeEqual(x, y)
}

const loginFails = new Map<string, { n: number; until: number }>()
const clientIp = (req: IncomingMessage) =>
  String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim()

// ---------- HTTP-утиліти ----------

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(data)
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, `Файл завеликий (до ${Math.round(limit / 1024 / 1024)} МБ)`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req, 1024 * 1024)
  try {
    return (buf.length ? JSON.parse(buf.toString('utf8')) : {}) as T
  } catch {
    throw new HttpError(400, 'Некоректний JSON')
  }
}

// ---------- Події для вкладок (SSE) ----------

const clients = new Set<ServerResponse>()

function emit(e: ServerEvent) {
  const data = `data: ${JSON.stringify(e)}\n\n`
  for (const c of clients) c.write(data)
}

function emitChat(chatId: string) {
  const chat = getChat(chatId)
  if (chat) emit({ type: 'chat', chat: publicChat(chat) })
}

setRunListeners((m) => emit({ type: 'message', message: publicMessage(m) }), emitChat)

setInterval(() => {
  for (const c of clients) c.write(': ping\n\n')
}, 20_000).unref()

// ---------- Логіка чату ----------

const newId = () => randomBytes(9).toString('base64url')

function shortTitle(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t
}

async function buildInput(text: string, attachments: Attachment[]): Promise<InputContent> {
  if (!attachments.length) return text
  const parts: Exclude<InputContent, string> = []
  const lines: string[] = []
  for (const a of attachments) {
    const u = getUpload(a.id)
    if (!u) continue
    lines.push(`- ${u.path} (${u.name}, ${u.mime}, ${Math.max(1, Math.round(u.size / 1024))} КБ)`)
    if (u.mime.startsWith('image/') && u.size <= MAX_INLINE_IMAGE) {
      const data = await readFile(u.path)
      parts.push({ type: 'image_url', image_url: { url: `data:${u.mime};base64,${data.toString('base64')}` } })
    }
  }
  const note =
    `\n\n[Прикріплені файли. Вони збережені на цьому комп'ютері, відкривай їх своїми інструментами за потреби:]\n` +
    lines.join('\n')
  return [{ type: 'text', text: (text || 'Подивись прикріплені файли.') + note }, ...parts]
}

async function sendMessage(body: { chatId?: string; text?: string; attachments?: string[]; model?: ModelChoice }) {
  const text = String(body.text ?? '').trim()
  const attachments: Attachment[] = (body.attachments ?? [])
    .map((id) => getUpload(String(id)))
    .filter((u) => u != null)
    .map(({ path: _p, ...a }) => a)
  if (!text && !attachments.length) throw new HttpError(400, 'Порожнє повідомлення')

  let chat = body.chatId ? getChat(body.chatId) : null
  if (body.chatId && !chat) throw new HttpError(404, 'Чат не знайдено')
  if (!chat) {
    const id = newId()
    chat = createChat(id, `webchat-${id}`, body.model ?? null)
    updateChat(id, { title: shortTitle(text || attachments[0]!.name), titleSource: 'auto' })
  } else if (body.model !== undefined) {
    updateChat(chat.id, { model: body.model })
  }
  if (chat.running) throw new HttpError(409, 'Hermes ще працює над попередньою задачею')
  chat = getChat(chat.id)!

  const now = Date.now()
  const user: MessageRow = {
    id: newId(),
    chatId: chat.id,
    role: 'user',
    text,
    attachments,
    parts: [],
    status: 'done',
    error: null,
    usage: null,
    model: null,
    createdAt: now,
    finishedAt: now,
    runId: null,
    lastSeq: -1,
  }
  const assistant: MessageRow = {
    ...user,
    id: newId(),
    role: 'assistant',
    text: '',
    attachments: [],
    status: 'queued',
    createdAt: now + 1,
    finishedAt: null,
    model: chat.model?.model ?? null,
  }
  insertMessage(user)
  insertMessage(assistant)
  updateChat(chat.id, { touch: true })
  emitChat(chat.id)

  try {
    assistant.runId = await startRun({
      sessionId: chat.sessionId,
      input: await buildInput(text, attachments),
      idempotencyKey: assistant.id,
      model: chat.model,
    })
    assistant.status = 'running'
    track(assistant)
  } catch (err) {
    failMessage(assistant, `Hermes не прийняв задачу: ${(err as Error).message}`)
  }
  return { chat: publicChat(getChat(chat.id)!), messages: [publicMessage(user), publicMessage(liveMessage(assistant.id)!)] }
}

function activeRun(messageId: string): MessageRow {
  const m = liveMessage(messageId)
  if (!m) throw new HttpError(404, 'Повідомлення не знайдено')
  if (!m.runId) throw new HttpError(409, 'Задача не запущена')
  return m
}

const EXT_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

// ---------- Маршрути API ----------

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (path === '/api/login' && method === 'POST') {
    const ip = clientIp(req)
    const f = loginFails.get(ip)
    if (f && f.until > Date.now()) throw new HttpError(429, 'Забагато спроб. Спробуй за хвилину.')
    const { username, password } = await readJson<{ username?: string; password?: string }>(req)
    const cfg = loadConfig()
    if (!same(String(username ?? '').trim(), cfg.username) || !same(String(password ?? ''), cfg.password)) {
      const n = (f?.n ?? 0) + 1
      loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 })
      throw new HttpError(401, 'Неправильний логін або пароль')
    }
    loginFails.delete(ip)
    const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip'])
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `chat_session=${sessionCookie()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`,
    })
  }
  if (path === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'chat_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' })
  }
  if (!authed(req)) throw new HttpError(401, 'Потрібен вхід')

  if (path === '/api/me') return send(res, 200, { username: loadConfig().username })

  if (path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': open\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (path === '/api/models') {
    try {
      return send(res, 200, await modelOptions())
    } catch (err) {
      throw new HttpError(502, (err as Error).message)
    }
  }

  if (path === '/api/chats' && method === 'GET') return send(res, 200, listChats().map(publicChat))
  if (path === '/api/messages' && method === 'POST') return send(res, 200, await sendMessage(await readJson(req)))

  let m = path.match(/^\/api\/chats\/([\w-]+)$/)
  if (m) {
    const chat = getChat(m[1]!)
    if (!chat) throw new HttpError(404, 'Чат не знайдено')
    if (method === 'GET') {
      return send(res, 200, {
        chat: publicChat(chat),
        messages: listMessages(chat.id).map((x) => publicMessage(liveMessage(x.id) ?? x)),
      })
    }
    if (method === 'PATCH') {
      const b = await readJson<{ title?: string; pinned?: boolean; model?: ModelChoice }>(req)
      if (typeof b.title === 'string' && b.title.trim()) {
        const title = b.title.trim().slice(0, 120)
        updateChat(chat.id, { title, titleSource: 'user' })
        void renameSession(chat.sessionId, title)
      }
      if (typeof b.pinned === 'boolean') updateChat(chat.id, { pinned: b.pinned })
      if (b.model !== undefined) updateChat(chat.id, { model: b.model })
      emitChat(chat.id)
      return send(res, 200, publicChat(getChat(chat.id)!))
    }
    if (method === 'DELETE') {
      for (const msg of listMessages(chat.id)) {
        const l = liveMessage(msg.id)
        if (l?.runId && ['queued', 'running', 'stopping'].includes(l.status)) await stopRun(l.runId).catch(() => {})
      }
      deleteChat(chat.id)
      void deleteSession(chat.sessionId)
      emit({ type: 'chat-deleted', chatId: chat.id })
      return send(res, 200, { ok: true })
    }
  }

  m = path.match(/^\/api\/messages\/([\w-]+)\/(stop|steer|approval|clarify)$/)
  if (m && method === 'POST') {
    const msg = activeRun(m[1]!)
    const action = m[2]
    try {
      if (action === 'stop') {
        await stopRun(msg.runId!)
      } else if (action === 'steer') {
        const { text } = await readJson<{ text?: string }>(req)
        if (!text?.trim()) throw new HttpError(400, 'Порожній текст')
        await steerRun(msg.runId!, text.trim())
        addSteer(msg.id, text.trim())
      } else {
        const b = await readJson<{ promptId?: string; generation?: number; value?: string }>(req)
        if (!b.promptId || typeof b.value !== 'string') throw new HttpError(400, 'Немає відповіді')
        if (action === 'approval') await answerApproval(msg.runId!, b.promptId, Number(b.generation ?? 0), b.value)
        else await answerClarify(msg.runId!, b.promptId, Number(b.generation ?? 0), b.value)
        markAnswered(msg.id, b.promptId, b.value)
      }
    } catch (err) {
      if (err instanceof HermesError) throw new HttpError(err.status === 409 ? 409 : 502, err.message)
      throw err
    }
    return send(res, 200, { ok: true })
  }

  if (path === '/api/uploads' && method === 'POST') {
    const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file')).replace(/[/\\\0]/g, '_').slice(0, 180) || 'file'
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim()
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

  m = path.match(/^\/api\/uploads\/([\w-]+)$/)
  if (m && method === 'GET') {
    const u = getUpload(m[1]!)
    if (!u || !existsSync(u.path)) throw new HttpError(404, 'Файл не знайдено')
    const inline = u.mime.startsWith('image/') || u.mime === 'application/pdf'
    res.writeHead(200, {
      'Content-Type': u.mime,
      'Content-Length': String(u.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(u.name)}`,
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(await readFile(u.path))
    return
  }

  throw new HttpError(404, 'Невідомий маршрут')
}

// ---------- Сервер ----------

let handler: (req: IncomingMessage, res: ServerResponse) => void

if (DEV) {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' })
  handler = (req, res) => vite.middlewares(req, res)
} else {
  const index = await readFile(join(DIST, 'index.html'))
  handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const file = normalize(join(DIST, decodeURIComponent(url.pathname)))
    if (file.startsWith(DIST + sep) && extname(file) && existsSync(file)) {
      const immutable = url.pathname.startsWith('/assets/')
      res.writeHead(200, {
        'Content-Type': EXT_MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      res.end(await readFile(file))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(index)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (!url.pathname.startsWith('/api/')) return handler(req, res)
  try {
    await api(req, res, url)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error(err)
    if (!res.headersSent) send(res, status, { error: (err as Error).message })
    else res.end()
  }
})

loadConfig()
resumeActiveRuns()
server.listen(PORT, '127.0.0.1', () => console.log(`chat: http://127.0.0.1:${PORT}${DEV ? ' (dev)' : ''}`))

function shutdown() {
  stopAll()
  for (const c of clients) c.end()
  server.close()
  closeDb()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
