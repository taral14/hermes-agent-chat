import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  Attachment,
  ChatMode,
  LinkPreview,
  ModelChoice,
  ServerEvent,
  SettingsInfo,
  ShareInfo,
  ShareListItem,
  SharedChat,
  StorageInfo,
} from '../src/shared.ts'
import { execFileSync } from 'node:child_process'
import { answerUrls, findUrls } from '../src/links.ts'
import { cachedPreview, unfurl } from './unfurl.ts'
import {
  DATA_DIR,
  DEFAULT_PUSH,
  type ShareRow,
  clearLinkPreviews,
  countLinkPreviews,
  listShares,
  listUploads,
  deleteShare,
  getShare,
  getShareByChat,
  upsertShare,
  type UploadRow,
  createDownloadLink,
  resolveDownloadLink,
  createList,
  deleteList,
  listLists,
  updateList,
  getMessage,
  type PasskeyRow,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  setSetting,
  type PushSettings,
  deletePushSub,
  getPushSub,
  savePushSub,
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
  createLoginSession,
  deleteOtherLoginSessions,
  deleteLoginSession,
  getLoginSession,
  getSetting,
  listLoginSessions,
  touchLoginSession,
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
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { PasskeyError, loginOptions, loginVerify, passwordLoginAllowed, registerVerify, registrationOptions } from './passkeys.ts'
import { getNote, graph, listNotes, resolveLink, searchNotes, vaultFile, vaultInfo, watchVault } from './vault.ts'
import { createJob, deleteJob, getJob, jobAction, jobRuns, listJobs, runOutput, updateJob } from './jobs.ts'
import { mimeOf, sweepUploads } from './media.ts'
import { chatInstructions, chatPrefs, updateChatPrefs } from './prefs.ts'
import {
  NativeError,
  commandCatalog,
  initNative,
  approvePending,
  nativeAnswer,
  nativeBranch,
  nativeCommand,
  nativeControl,
  nativeDelete,
  nativeRename,
  nativeRewind,
  nativeSend,
  nativeSteer,
  nativeStop,
} from './native.ts'
import { gateway } from './gateway.ts'
import { VAPID_PUBLIC, jobsWatched, sendTest, setPresence } from './push.ts'
import {
  activeRunCount,
  addSteer,
  approvePendingApi,
  backfillMedia,
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

type Config = { username: string; password: string; allowPassword: boolean }

/** Логін і пароль єдиного користувача — у config.yaml поруч із package.json (не в git). */
function loadConfig(): Config {
  const file = join(ROOT, 'config.yaml')
  if (!existsSync(file)) throw new Error(`Немає ${file}: створи його з полями username і password`)
  const c = parseYaml(readFileSync(file, 'utf8')) as Partial<Config> | null
  if (!c?.username || !c?.password) throw new Error('config.yaml: потрібні username і password')
  // allow_password: true — аварійний вхід за паролем, навіть якщо в чаті ввімкнено «лише ключі».
  return { username: String(c.username), password: String(c.password), allowPassword: (c as { allow_password?: unknown }).allow_password === true }
}

const SECRET_FILE = join(DATA_DIR, '.session-secret')
if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
const SECRET = readFileSync(SECRET_FILE, 'utf8').trim()

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url')

/**
 * Cookie входу: <id сесії>.<підпис>. Сесія живе в базі, тож вихід її справді відкликає.
 * Пароль входить у підпис: зміна пароля в config.yaml розлогінює всі пристрої.
 */
const cookieMac = (id: string) => sign(`${id}|${loadConfig().password}`)

function newSession(req: IncomingMessage): string {
  const id = randomBytes(24).toString('base64url')
  createLoginSession(id, Date.now() + SESSION_DAYS * 86400_000, String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req))
  return `${id}.${cookieMac(id)}`
}

/** id сесії з cookie, якщо вона дійсна. */
function sessionId(req: IncomingMessage): string | null {
  const raw = req.headers.cookie?.match(/(?:^|;\s*)chat_session=([^;]+)/)?.[1]
  if (!raw) return null
  const [id, mac] = raw.split('.')
  if (!id || !mac) return null
  const expected = Buffer.from(cookieMac(id))
  const got = Buffer.from(mac)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  const s = getLoginSession(id)
  if (!s || s.expiresAt < Date.now()) return null
  if (Date.now() - s.lastSeen > 5 * 60_000) touchLoginSession(id, clientIp(req))
  return id
}

const authed = (req: IncomingMessage) => sessionId(req) !== null

function same(a: string, b: string) {
  const x = createHmac('sha256', SECRET).update(a).digest()
  const y = createHmac('sha256', SECRET).update(b).digest()
  return timingSafeEqual(x, y)
}

function loginCookie(req: IncomingMessage) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip'])
  return `chat_session=${newSession(req)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

const loginFails = new Map<string, { n: number; until: number }>()

/**
 * Загальний ліміт невдалих входів з усіх адрес разом, збережений у базі: перебір з багатьох IP
 * чи через перезапуски сервера не допоможе. 20 помилок за 15 хв — вхід за паролем стоїть 15 хв.
 */
const GLOBAL_FAILS = 20
const GLOBAL_WINDOW = 15 * 60_000
function globalLocked(): boolean {
  const g = JSON.parse(getSetting('login_fails') ?? '{}') as { start?: number; n?: number }
  return (g.n ?? 0) >= GLOBAL_FAILS && Date.now() - (g.start ?? 0) < GLOBAL_WINDOW
}
function globalFail() {
  const g = JSON.parse(getSetting('login_fails') ?? '{}') as { start?: number; n?: number }
  const fresh = !g.start || Date.now() - g.start > GLOBAL_WINDOW
  setSetting('login_fails', JSON.stringify(fresh ? { start: Date.now(), n: 1 } : { start: g.start, n: (g.n ?? 0) + 1 }))
}
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
 * Захист від підробки запитів (CSRF). Сусідні сайти на *.example.com браузер вважає «тим самим сайтом»
 * і шле їм нашу cookie, тому SameSite=Lax тут не рятує. Змінювати щось можна лише зі сторінки самого чату.
 */
function sameOrigin(req: IncomingMessage): boolean {
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

/** Заголовки для сторінки й статики: без чужих скриптів, без вбудовування у фрейм. */
const PAGE_HEADERS: Record<string, string> = {
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

/** Пуші йдуть лише на сервери браузерів: сервер не має стукати на довільні адреси (SSRF). */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/]
function pushHostAllowed(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
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
const isMode = (v: unknown): v is ChatMode => v === 'ask' || v === 'auto' || v === 'plan'

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

async function sendMessage(body: { chatId?: string; text?: string; attachments?: string[]; model?: ModelChoice; mode?: string; listId?: string }) {
  const text = String(body.text ?? '').trim()
  const attachments: Attachment[] = (body.attachments ?? [])
    .map((id) => getUpload(String(id)))
    .filter((u) => u != null)
    .map(({ path: _p, ...a }) => a)
  if (!text && !attachments.length) throw new HttpError(400, 'Порожнє повідомлення')

  let chat = body.chatId ? getChat(body.chatId) : null
  if (body.chatId && !chat) throw new HttpError(404, 'Чат не знайдено')
  if (!chat) {
    // Нові чати — на рідному протоколі Hermes; сесія створиться при відправці.
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

  if (chat.engine === 'native') {
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
      instructions: chatInstructions(),
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
  '.webp': 'image/webp',
}

// ---------- Віддача файлів ----------

const LINK_TTL = 60 * 60_000

/**
 * Файл частинами (Range): аудіо й відео в Safari, докачування великих файлів. Великі файли — це оригінали на
 * Mac mini, вони читаються потоком без копіювання.
 */
function serveFile(req: IncomingMessage, res: ServerResponse, u: UploadRow, forceDownload: boolean, privateCache = true) {
  const inline = /^(image|audio|video)\//.test(u.mime) || u.mime === 'application/pdf' || u.mime.startsWith('text/plain')
  const download = forceDownload || !inline
  const size = statSync(u.path).size
  const headers: Record<string, string> = {
    'Content-Type': u.mime === 'text/plain' ? 'text/plain; charset=utf-8' : u.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': privateCache ? 'private, max-age=31536000, immutable' : 'no-store',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(u.name)}`,
    'X-Content-Type-Options': 'nosniff',
  }
  // Завантажені й згенеровані файли не мають права виконувати скрипти на нашому домені (SVG тощо).
  // PDF лишаємо без sandbox, інакше браузер не відкриє свій переглядач.
  if (u.mime !== 'application/pdf') {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    start = Math.max(0, start)
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
    const stream = createReadStream(u.path, { start, end })
    res.on('close', () => stream.destroy())
    stream.pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(size) })
  if (req.method === 'HEAD') return void res.end()
  const stream = createReadStream(u.path)
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

/** /dl/<токен>/<назва> — тимчасове посилання без входу: завантаження великого файлу з Mac mini. */
function serveDownloadLink(req: IncomingMessage, res: ServerResponse, token: string) {
  const u = resolveDownloadLink(token)
  if (!u || !existsSync(u.path)) {
    res.writeHead(u ? 410 : 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(u ? 'Файл переміщено або видалено з Mac mini.' : 'Посилання недійсне або його термін минув.')
    return
  }
  serveFile(req, res, u, true, false)
}

// ---------- Спільний доступ (лише перегляд) ----------

const SHARE_ACTIVE = new Set(['queued', 'running', 'stopping'])
const PUBLIC_ORIGIN = `https://${process.env.PUBLIC_HOST ?? 'chat.example.com'}`

/** Повідомлення, що потрапляють у посилання: до моменту `upto`, завершені й не порожні. */
function sharedMessages(share: ShareRow) {
  return listMessages(share.chatId).filter((m) => m.createdAt <= share.upto && !SHARE_ACTIVE.has(m.status) && (m.text.trim() || m.attachments.length))
}

function shareInfo(share: ShareRow): ShareInfo {
  const all = listMessages(share.chatId).filter((m) => m.text.trim() || m.attachments.length)
  const count = all.filter((m) => m.createdAt <= share.upto).length
  return { ...share, url: `${PUBLIC_ORIGIN}/s/${share.token}`, count, newer: all.length - count }
}

/**
 * Знімок для глядача: лише текст і вкладення. Хід роботи Hermes (команди, шляхи, результати інструментів)
 * не показуємо, а великі файли, що лежать на Mac mini без копії, лишаються тільки назвою.
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

/** Посилання, для яких повідомлення показує картки: у питаннях — до трьох, у відповідях — відео й джерела. */
function linkTargets(m: { role: string; text: string }): string[] {
  if (m.role === 'user') return findUrls(m.text.replace(/^(>.*\n?)+/, ''))
  const a = answerUrls(m.text)
  return [...a.videos, ...a.links]
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Публічні маршрути спільного доступу: працюють без входу. */
async function publicApi(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const m = /^\/api\/public\/share\/([\w-]{20,})(?:\/file\/([\w-]+))?$/.exec(path)
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return false
  const share = getShare(m[1]!)
  const noindex = { 'X-Robots-Tag': 'noindex, nofollow' }
  if (!share) {
    send(res, 404, { error: 'Посилання недійсне або власник його видалив' }, noindex)
    return true
  }
  if (!m[2]) {
    const data = sharedChat(share)
    if (!data) send(res, 404, { error: 'Чат видалено' }, noindex)
    else send(res, 200, data, noindex)
    return true
  }
  // Файл віддаємо, лише якщо він прикріплений до повідомлення з посилання і скопійований у чат.
  const fileId = m[2]
  const allowed = sharedMessages(share).some((x) => x.attachments.some((a) => a.id === fileId && !a.ref))
  const u = allowed ? getUpload(fileId) : null
  if (!u || !existsSync(u.path)) {
    send(res, 404, { error: 'Файл недоступний' }, noindex)
    return true
  }
  serveFile(req, res, u, url.searchParams.has('download'))
  return true
}

/** Видалити чат повністю: зупинити роботу Hermes, прибрати файли, сесію Hermes і посилання. */
async function removeChat(chat: NonNullable<ReturnType<typeof getChat>>) {
  for (const msg of listMessages(chat.id)) {
    const l = liveMessage(msg.id)
    if (!l?.runId || !['queued', 'running', 'stopping'].includes(l.status)) continue
    if (chat.engine === 'native') await nativeStop(l.id).catch(() => {})
    else await stopRun(l.runId).catch(() => {})
  }
  // Вкладення цього чату, які більше ніде не використовуються, видаляємо одразу.
  const attached = new Set(listMessages(chat.id).flatMap((x) => x.attachments.map((a) => a.id)))
  deleteChat(chat.id)
  if (attached.size) sweepUploads(0, attached)
  if (chat.engine === 'native') void nativeDelete(chat)
  else void deleteSession(chat.sessionId)
  emit({ type: 'chat-deleted', chatId: chat.id })
}

// ---------- Налаштування, дані, експорт ----------

const STARTED_AT = Date.now()
const VERSION = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, timeout: 3000 }).toString().trim()
  } catch {
    return 'невідома'
  }
})()

function storageInfo(): StorageInfo {
  let files = 0
  let bytes = 0
  let macFiles = 0
  for (const u of listUploads()) {
    if (u.ref) {
      macFiles++
      continue
    }
    files++
    bytes += u.size
  }
  let dbBytes = 0
  for (const f of ['chat.db', 'chat.db-wal']) {
    try {
      dbBytes += statSync(join(DATA_DIR, f)).size
    } catch {
      /* немає файлу */
    }
  }
  return { files, bytes, macFiles, linkCache: countLinkPreviews(), dbBytes }
}

/** Усі чати одним Markdown-файлом: заголовки, хто що сказав, назви файлів. */
function exportMarkdown(): string {
  const fmt = new Intl.DateTimeFormat('uk', { dateStyle: 'long', timeStyle: 'short' })
  const out = [`# Чати з Hermes`, '', `Експорт від ${fmt.format(Date.now())}.`, '']
  for (const chat of listChats()) {
    out.push('---', '', `## ${chat.title || 'Без назви'}`, '', `_${fmt.format(chat.createdAt)}_`, '')
    for (const m of listMessages(chat.id)) {
      if (!m.text.trim() && !m.attachments.length) continue
      out.push(`### ${m.role === 'user' ? 'Я' : 'Hermes'} · ${fmt.format(m.createdAt)}`, '')
      if (m.text.trim()) out.push(m.text.trim(), '')
      for (const a of m.attachments) out.push(`📎 ${a.name} (${Math.max(1, Math.round(a.size / 1024))} КБ)`)
      if (m.attachments.length) out.push('')
    }
  }
  return out.join('\n')
}

// ---------- Маршрути API ----------

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (path === '/api/login' && method === 'POST') {
    const ip = clientIp(req)
    const f = loginFails.get(ip)
    if (f && f.until > Date.now()) throw new HttpError(429, 'Забагато спроб. Спробуй за хвилину.')
    if (globalLocked()) throw new HttpError(429, 'Забагато невдалих спроб. Вхід за паролем призупинено на 15 хвилин.')
    const { username, password } = await readJson<{ username?: string; password?: string }>(req)
    const cfg = loadConfig()
    if (!passwordLoginAllowed() && !cfg.allowPassword) throw new HttpError(403, 'Вхід за паролем вимкнено. Увійди з ключем.')
    if (!same(String(username ?? '').trim(), cfg.username) || !same(String(password ?? ''), cfg.password)) {
      const n = (f?.n ?? 0) + 1
      loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 })
      globalFail()
      throw new HttpError(401, 'Неправильний логін або пароль')
    }
    loginFails.delete(ip)
    return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req) })
  }

  // ---------- Ключі доступу ----------
  if (path === '/api/auth/methods') {
    return send(res, 200, { passkeys: listPasskeys().length > 0, password: passwordLoginAllowed() || loadConfig().allowPassword })
  }
  try {
    if (path === '/api/auth/passkey/options' && method === 'POST') {
      const b = await readJson<{ autofill?: boolean }>(req)
      return send(res, 200, await loginOptions(req, Boolean(b.autofill)))
    }
    if (path === '/api/auth/passkey/login' && method === 'POST') {
      const ip = clientIp(req)
      const f = loginFails.get(ip)
      if (f && f.until > Date.now()) throw new HttpError(429, 'Забагато спроб. Спробуй за хвилину.')
      const b = await readJson<{ challengeId?: string; response?: AuthenticationResponseJSON }>(req)
      if (!b.response) throw new HttpError(400, 'Немає відповіді ключа')
      try {
        await loginVerify(b.challengeId, b.response)
      } catch (err) {
        const n = (f?.n ?? 0) + 1
        loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 })
        throw err
      }
      loginFails.delete(ip)
      return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req) })
    }
  } catch (err) {
    if (err instanceof PasskeyError) throw new HttpError(400, err.message)
    if (err instanceof HttpError) throw err
    throw new HttpError(400, `Ключ не підійшов: ${(err as Error).message}`)
  }
  if (path === '/api/logout' && method === 'POST') {
    const sid = sessionId(req)
    if (sid) deleteLoginSession(sid)
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'chat_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' })
  }
  // Пінг для роутера: тримає сервер живим, поки Hermes працює (див. keepAlive нижче).
  if (path === '/api/ping') {
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    return void res.end()
  }
  if (path.startsWith('/api/public/') && (await publicApi(req, res, path, url))) return
  if (!authed(req)) throw new HttpError(401, 'Потрібен вхід')

  // Картка посилання з повідомлення: заголовок, опис, картинка. Сервер читає сторінку сам (див. unfurl.ts).
  if (path === '/api/unfurl' && method === 'GET') {
    const target = url.searchParams.get('url') ?? ''
    if (!/^https?:\/\//i.test(target) || target.length > 2000) throw new HttpError(400, 'Некоректне посилання')
    return send(res, 200, await unfurl(target), { 'Cache-Control': 'private, max-age=3600' })
  }

  if (path === '/api/presence' && method === 'POST') {
    const b = await readJson<{ clientId?: string; visible?: boolean; chatId?: string | null }>(req)
    if (typeof b.clientId === 'string' && b.clientId.length < 80) setPresence(b.clientId, Boolean(b.visible), b.chatId ?? null)
    return send(res, 200, { ok: true })
  }
  if (path === '/api/push/key') return send(res, 200, { publicKey: VAPID_PUBLIC })
  if (path.startsWith('/api/push/') && method === 'POST') {
    const b = await readJson<{
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      endpoint?: string
      settings?: Partial<PushSettings>
    }>(req)
    const endpoint = b.subscription?.endpoint ?? b.endpoint ?? ''
    if (!pushHostAllowed(endpoint)) throw new HttpError(400, 'Немає підписки')
    const action = path.slice('/api/push/'.length)
    const clean = (x?: Partial<PushSettings>): Partial<PushSettings> =>
      Object.fromEntries(Object.entries(x ?? {}).filter(([k, v]) => k in DEFAULT_PUSH && typeof v === 'boolean'))
    if (action === 'subscribe') {
      const k = b.subscription?.keys
      if (!k?.p256dh || !k.auth) throw new HttpError(400, 'Неповна підписка')
      const prev = getPushSub(endpoint)
      const sub = { endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, settings: { ...DEFAULT_PUSH, ...prev?.settings, ...clean(b.settings) }, ua: String(req.headers['user-agent'] ?? '').slice(0, 200) }
      savePushSub(sub)
      return send(res, 200, sub.settings)
    }
    const sub = getPushSub(endpoint)
    if (action === 'status') return send(res, 200, sub ? sub.settings : null)
    if (!sub) throw new HttpError(404, 'Цей пристрій не підписаний')
    if (action === 'settings') {
      sub.settings = { ...sub.settings, ...clean(b.settings) }
      savePushSub(sub)
      return send(res, 200, sub.settings)
    }
    if (action === 'unsubscribe') {
      deletePushSub(endpoint)
      return send(res, 200, { ok: true })
    }
    if (action === 'test') {
      await sendTest(sub)
      return send(res, 200, { ok: true })
    }
  }

  if (path === '/api/me') return send(res, 200, { username: loadConfig().username })

  if (path.startsWith('/api/auth/')) {
    try {
      const pub = (k: PasskeyRow) => ({ id: k.id, name: k.name, kind: k.kind, backedUp: k.backedUp, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })
      const sid = sessionId(req)
      const security = () => ({
        passkeys: listPasskeys().map(pub),
        passwordLogin: passwordLoginAllowed(),
        sessions: listLoginSessions().map((x) => ({ id: x.id.slice(0, 8), createdAt: x.createdAt, lastSeen: x.lastSeen, ua: x.ua, ip: x.ip, current: x.id === sid })),
      })
      if (path === '/api/auth/security' && method === 'GET') return send(res, 200, security())
      if (path === '/api/auth/passkeys/options' && method === 'POST') {
        const b = await readJson<{ kind?: string }>(req)
        return send(res, 200, await registrationOptions(req, loadConfig().username, b.kind === 'security-key' ? 'security-key' : 'device'))
      }
      if (path === '/api/auth/passkeys' && method === 'POST') {
        const b = await readJson<{ challengeId?: string; response?: RegistrationResponseJSON; name?: string }>(req)
        if (!b.response) throw new HttpError(400, 'Немає відповіді ключа')
        await registerVerify(req, b.challengeId, b.response, b.name)
        return send(res, 200, security())
      }
      const k = path.match(/^\/api\/auth\/passkeys\/([\w-]+)$/)
      if (k && method === 'PATCH') {
        const b = await readJson<{ name?: string }>(req)
        if (b.name?.trim()) renamePasskey(k[1]!, b.name.trim().slice(0, 60))
        return send(res, 200, security())
      }
      if (k && method === 'DELETE') {
        deletePasskey(k[1]!)
        // Без жодного ключа «лише ключі» не має сенсу: повертаємо вхід за паролем, щоб не замкнутись.
        if (!listPasskeys().length) setSetting('password_login', 'on')
        return send(res, 200, security())
      }
      // Вийти на всіх інших пристроях: лишається тільки поточна сесія.
      if (path === '/api/auth/sessions/revoke-others' && method === 'POST') {
        if (sid) deleteOtherLoginSessions(sid)
        return send(res, 200, security())
      }
      const sx = path.match(/^\/api\/auth\/sessions\/([\w-]{8})$/)
      if (sx && method === 'DELETE') {
        const target = listLoginSessions().find((x) => x.id.startsWith(sx[1]!) && x.id !== sid)
        if (target) deleteLoginSession(target.id)
        return send(res, 200, security())
      }
      if (path === '/api/auth/password-login' && method === 'POST') {
        const b = await readJson<{ enabled?: boolean }>(req)
        if (b.enabled === false && !listPasskeys().length) throw new HttpError(400, 'Спершу додай хоча б один ключ')
        setSetting('password_login', b.enabled === false ? 'off' : 'on')
        return send(res, 200, security())
      }
    } catch (err) {
      if (err instanceof PasskeyError) throw new HttpError(400, err.message)
      if (err instanceof HttpError) throw err
      throw new HttpError(400, `Не вдалося: ${(err as Error).message}`)
    }
  }

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
  if (path === '/api/messages' && method === 'POST') return send(res, 200, await sendMessage(await readJson(req)))

  if (path === '/api/settings' && method === 'GET') {
    const info: SettingsInfo = {
      prefs: chatPrefs(),
      about: { version: VERSION, startedAt: STARTED_AT, hermes: gateway.connected, vault: (await vaultInfo()).available },
    }
    return send(res, 200, info)
  }
  if (path === '/api/settings' && method === 'PATCH') {
    return send(res, 200, updateChatPrefs(await readJson<Record<string, unknown>>(req)))
  }
  if (path === '/api/shares' && method === 'GET') {
    const list: ShareListItem[] = listShares().map((x) => ({
      chatId: x.chatId,
      title: getChat(x.chatId)?.title || 'Без назви',
      url: `${PUBLIC_ORIGIN}/s/${x.token}`,
      updatedAt: x.updatedAt,
    }))
    return send(res, 200, list)
  }
  if (path === '/api/storage' && method === 'GET') return send(res, 200, storageInfo())
  if (path === '/api/storage/link-cache' && method === 'DELETE') {
    clearLinkPreviews()
    return send(res, 200, storageInfo())
  }
  if (path === '/api/export' && method === 'GET') {
    const name = `hermes-chats-${new Date().toISOString().slice(0, 10)}.md`
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return void res.end(exportMarkdown())
  }
  // Видалити всі чати. Потрібне підтвердження словом, щоб випадковий запит нічого не стер.
  if (path === '/api/chats/delete-all' && method === 'POST') {
    const b = await readJson<{ confirm?: string }>(req)
    if (b.confirm !== 'видалити') throw new HttpError(400, 'Потрібне підтвердження')
    const all = listChats()
    for (const c of all) await removeChat(c)
    return send(res, 200, { deleted: all.length })
  }

  // Посилання лише для перегляду: створити, оновити до поточного стану, видалити.
  const sh = path.match(/^\/api\/chats\/([\w-]+)\/share$/)
  if (sh) {
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
  }

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
      const b = await readJson<{ title?: string; pinned?: boolean; model?: ModelChoice; mode?: string; listId?: string | null }>(req)
      if (typeof b.title === 'string' && b.title.trim()) {
        const title = b.title.trim().slice(0, 120)
        updateChat(chat.id, { title, titleSource: 'user' })
        if (chat.engine === 'native') void nativeRename(chat, title)
        else void renameSession(chat.sessionId, title)
      }
      if (typeof b.pinned === 'boolean') updateChat(chat.id, { pinned: b.pinned })
      if (b.listId === null || (typeof b.listId === 'string' && listLists().some((l) => l.id === b.listId))) updateChat(chat.id, { listId: b.listId })
      if (b.model !== undefined) updateChat(chat.id, { model: b.model })
      if (isMode(b.mode)) {
        updateChat(chat.id, { mode: b.mode })
        if (b.mode === 'auto') {
          if (chat.engine === 'native') approvePending(getChat(chat.id)!)
          else approvePendingApi(chat.id)
        }
      }
      emitChat(chat.id)
      return send(res, 200, publicChat(getChat(chat.id)!))
    }
    if (method === 'DELETE') {
      await removeChat(chat)
      return send(res, 200, { ok: true })
    }
  }

  // Повтор, редагування й відгалуження — лише для чатів на рідному протоколі.
  m = path.match(/^\/api\/messages\/([\w-]+)\/(retry|edit|branch)$/)
  if (m && method === 'POST') {
    const target = getMessage(m[1]!)
    const chat = target ? getChat(target.chatId) : null
    if (!target || !chat) throw new HttpError(404, 'Повідомлення не знайдено')
    if (chat.engine !== 'native') throw new HttpError(400, 'Цей чат створено до оновлення: повтор і гілки працюють лише в нових чатах')
    try {
      if (m[2] === 'branch') {
        const id = await nativeBranch(chat, target.id)
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
      const b = m[2] === 'edit' ? await readJson<{ text?: string }>(req) : {}
      if (m[2] === 'edit' && !b.text?.trim()) throw new HttpError(400, 'Порожній текст')
      await nativeRewind(chat, userId, b.text)
      emitChat(chat.id)
      return send(res, 200, { chat: publicChat(getChat(chat.id)!), messages: listMessages(chat.id).map((x) => publicMessage(liveMessage(x.id) ?? x)) })
    } catch (err) {
      if (err instanceof NativeError) throw new HttpError(err.status, err.message)
      throw err
    }
  }

  m = path.match(/^\/api\/chats\/([\w-]+)\/control$/)
  if (m && method === 'POST') {
    const chat = getChat(m[1]!)
    if (!chat || chat.engine !== 'native') throw new HttpError(404, 'Чат не знайдено')
    const { command } = await readJson<{ command?: string }>(req)
    // Лише керування автоматизаціями сесії, без довільних команд.
    if (!command || !/^\/(goal|loop|heartbeat)( (pause|resume|clear|stop|off|status))?$/.test(command.trim())) throw new HttpError(400, 'Невідома дія')
    try {
      const output = await nativeControl(chat, command.trim())
      return send(res, 200, { output })
    } catch (err) {
      if (err instanceof NativeError) throw new HttpError(err.status, err.message)
      throw err
    }
  }

  // ---------- База знань (Obsidian-сховище Hermes) ----------
  if (path.startsWith('/api/kb')) {
    if (path === '/api/kb') return send(res, 200, { ...(await vaultInfo()), list: await listNotes() })
    if (path === '/api/kb/note') {
      const note = await getNote(url.searchParams.get('path') ?? '')
      if (!note) throw new HttpError(404, 'Нотатку не знайдено')
      return send(res, 200, note)
    }
    if (path === '/api/kb/search') return send(res, 200, await searchNotes(url.searchParams.get('q') ?? ''))
    if (path === '/api/kb/graph') return send(res, 200, await graph())
    if (path === '/api/kb/resolve') return send(res, 200, { path: resolveLink(url.searchParams.get('target') ?? '') })
    if (path === '/api/kb/file') {
      const rel = url.searchParams.get('path') ?? ''
      const full = vaultFile(rel)
      if (!full) throw new HttpError(404, 'Файл не знайдено')
      const mime = rel.endsWith('.md') ? 'text/markdown; charset=utf-8' : mimeOf(rel)
      res.writeHead(200, {
        'Content-Type': mime.startsWith('text/') && !mime.includes('charset') ? `${mime}; charset=utf-8` : mime,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      })
      createReadStream(full).pipe(res)
      return
    }
  }

  if (path === '/api/commands') {
    try {
      return send(res, 200, await commandCatalog())
    } catch (err) {
      throw new HttpError(503, (err as Error).message)
    }
  }

  m = path.match(/^\/api\/messages\/([\w-]+)\/(stop|steer|approval|clarify)$/)
  if (m && method === 'POST' && getChat(liveMessage(m[1]!)?.chatId ?? '')?.engine === 'native') {
    const id = m[1]!
    try {
      if (m[2] === 'stop') await nativeStop(id)
      else if (m[2] === 'steer') {
        const { text } = await readJson<{ text?: string }>(req)
        if (!text?.trim()) throw new HttpError(400, 'Порожній текст')
        await nativeSteer(id, text.trim())
      } else {
        const b = await readJson<{ promptId?: string; generation?: number; value?: string }>(req)
        if (!b.promptId || typeof b.value !== 'string') throw new HttpError(400, 'Немає відповіді')
        await nativeAnswer(id, m[2] as 'approval' | 'clarify', b.promptId, Number(b.generation ?? 0), b.value)
      }
    } catch (err) {
      if (err instanceof NativeError) throw new HttpError(err.status, err.message)
      throw err
    }
    return send(res, 200, { ok: true })
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

  m = path.match(/^\/api\/uploads\/([\w-]+)\/link$/)
  if (m && method === 'POST') {
    const u = getUpload(m[1]!)
    if (!u) throw new HttpError(404, 'Файл не знайдено')
    if (!existsSync(u.path)) throw new HttpError(410, 'Файл переміщено або видалено з Mac mini')
    const token = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + LINK_TTL
    createDownloadLink(token, u.id, expiresAt)
    return send(res, 200, { url: `/dl/${token}/${encodeURIComponent(u.name)}`, expiresAt })
  }

  m = path.match(/^\/api\/uploads\/([\w-]+)$/)
  if (m && (method === 'GET' || method === 'HEAD')) {
    const u = getUpload(m[1]!)
    if (!u) throw new HttpError(404, 'Файл не знайдено')
    if (!existsSync(u.path)) throw new HttpError(410, 'Файл переміщено або видалено з Mac mini')
    return serveFile(req, res, u, url.searchParams.has('download'))
  }
  // ---------- Розклад (cron-задачі Hermes) ----------
  if (path.startsWith('/api/jobs')) {
    try {
      if (path === '/api/jobs' && method === 'GET') return send(res, 200, await listJobs())
      if (path === '/api/jobs' && method === 'POST') return send(res, 200, await createJob(await readJson(req)))
      const run = path.match(/^\/api\/jobs\/runs\/([\w-]+)$/)
      if (run && method === 'GET') return send(res, 200, { output: await runOutput(run[1]!) })
      const j = path.match(/^\/api\/jobs\/([\w-]+)(?:\/(runs|pause|resume|run))?$/)
      if (j) {
        const [, id, sub] = j as unknown as [string, string, string | undefined]
        if (!sub && method === 'GET') return send(res, 200, await getJob(id))
        if (!sub && method === 'PATCH') return send(res, 200, await updateJob(id, await readJson(req)))
        if (!sub && method === 'DELETE') {
          await deleteJob(id)
          return send(res, 200, { ok: true })
        }
        if (sub === 'runs' && method === 'GET') return send(res, 200, await jobRuns(id))
        if (sub && sub !== 'runs' && method === 'POST') {
          const job = await jobAction(id, sub as 'pause' | 'resume' | 'run')
          return send(res, 200, job ?? (await getJob(id)))
        }
      }
    } catch (err) {
      if (err instanceof HermesError) throw new HttpError(err.status >= 400 && err.status < 500 ? err.status : 502, err.message)
      throw err
    }
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
        ...PAGE_HEADERS,
      })
      res.end(await readFile(file))
      return
    }
    const share = /^\/s\/([\w-]{20,})\/?$/.exec(url.pathname)
    if (share) {
      // Сторінка спільного чату: назва для прев'ю в месенджерах і заборона індексації.
      const s = getShare(share[1]!)
      const title = s ? (getChat(s.chatId)?.title || 'Чат з Hermes') : 'Посилання недійсне'
      const meta =
        `<title>${escHtml(title)} · Hermes</title>` +
        `<meta property="og:title" content="${escHtml(title)}" />` +
        `<meta property="og:description" content="Діалог з Hermes · лише перегляд" />` +
        `<meta property="og:site_name" content="Hermes" />` +
        `<meta name="robots" content="noindex, nofollow" />`
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...PAGE_HEADERS })
      res.end(index.toString('utf8').replace('<title>Hermes</title>', meta))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...PAGE_HEADERS })
    res.end(index)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const dl = /^\/dl\/([\w-]{20,})(?:\/|$)/.exec(url.pathname)
  if (dl && (req.method === 'GET' || req.method === 'HEAD')) return serveDownloadLink(req, res, dl[1]!)
  if (!url.pathname.startsWith('/api/')) return handler(req, res)
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !sameOrigin(req)) {
    return send(res, 403, { error: 'Запит з іншого сайту відхилено' })
  }
  try {
    await api(req, res, url)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error(err)
    if (!res.headersSent) send(res, status, { error: (err as Error).message })
    else res.end()
  }
})

// Роутер зупиняє сервер після 30 хв без запитів. Поки Hermes працює над задачею або стежимо за розкладом,
// стукаємо до себе через роутер, щоб не пропустити подію і пуш.
const ROUTER = process.env.ROUTER_URL ?? 'http://127.0.0.1:8000'
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? 'chat.example.com'
if (!DEV) {
  setInterval(() => {
    if (!activeRunCount() && !jobsWatched()) return
    const r = httpRequest(`${ROUTER}/api/ping`, { headers: { Host: PUBLIC_HOST }, timeout: 10_000 }, (res) => res.resume())
    r.on('error', () => {})
    r.on('timeout', () => r.destroy())
    r.end()
  }, 5 * 60_000).unref()
}

loadConfig()
initNative(emitChat)
resumeActiveRuns()
backfillMedia()
sweepUploads()
setInterval(() => sweepUploads(), 6 * 3600_000).unref()

server.listen(PORT, '127.0.0.1', () => {
  console.log(`chat: http://127.0.0.1:${PORT}${DEV ? ' (dev)' : ''}`)
  // Сховище читаємо вже після старту: доступ до iCloud Drive не має затримувати сервер.
  void watchVault((paths) => emit({ type: 'kb', paths }))
})

function shutdown() {
  stopAll()
  gateway.stop()
  for (const c of clients) c.end()
  server.close()
  closeDb()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
