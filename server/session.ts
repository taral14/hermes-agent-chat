// Вхід єдиного користувача: config.yaml, сесійні cookie, ліміти невдалих спроб.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CONFIG_FILE } from './config.ts'
import { DATA_DIR, createLoginSession, getLoginSession, getSetting, setSetting, touchLoginSession } from './db.ts'
import { HttpError, clientIp } from './http.ts'

const SESSION_DAYS = 90

type Config = { username: string; password: string; allowPassword: boolean }
let configCache: { mtime: number; value: Config } | null = null

/**
 * Логін і пароль єдиного користувача — у config.yaml поруч із package.json (не в git).
 * Файл перечитується, лише коли змінився: правка пароля діє без перезапуску.
 */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) throw new Error(`Немає ${CONFIG_FILE}: створи його з полями username і password (див. config.example.yaml)`)
  const mtime = statSync(CONFIG_FILE).mtimeMs
  if (configCache?.mtime === mtime) return configCache.value
  const c = parseYaml(readFileSync(CONFIG_FILE, 'utf8')) as (Partial<Config> & { allow_password?: unknown }) | null
  if (!c?.username || !c?.password) {
    // Файл на півдорозі збереження: лишаємо попередні дані, якщо вони були.
    if (configCache) return configCache.value
    throw new Error('config.yaml: потрібні username і password')
  }
  // allow_password: true — аварійний вхід за паролем, навіть якщо в чаті ввімкнено «лише ключі».
  const value = { username: String(c.username), password: String(c.password), allowPassword: c.allow_password === true }
  configCache = { mtime, value }
  return value
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

/** id сесії з cookie, якщо вона дійсна. */
export function sessionId(req: IncomingMessage): string | null {
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

export const authed = (req: IncomingMessage) => sessionId(req) !== null

/** Порівняння без витоку довжини й часу. */
export function same(a: string, b: string) {
  const x = createHmac('sha256', SECRET).update(a).digest()
  const y = createHmac('sha256', SECRET).update(b).digest()
  return timingSafeEqual(x, y)
}

/** Нова сесія і cookie для неї. */
export function loginCookie(req: IncomingMessage) {
  const id = randomBytes(24).toString('base64url')
  createLoginSession(id, Date.now() + SESSION_DAYS * 86400_000, String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req))
  const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip'])
  return `chat_session=${id}.${cookieMac(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

export const LOGOUT_COOKIE = 'chat_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

// ---------- Ліміти невдалих спроб ----------

/** З однієї адреси: після 5 помилок — хвилина паузи. Мапа обмежена, щоб її не можна було роздути. */
const fails = new Map<string, { n: number; until: number; at: number }>()
const MAX_TRACKED = 5000

/**
 * Загальний ліміт невдалих входів з усіх адрес разом, збережений у базі: перебір з багатьох IP
 * чи через перезапуски сервера не допоможе. 20 помилок за 15 хв — вхід за паролем стоїть 15 хв.
 */
const GLOBAL_FAILS = 20
const GLOBAL_WINDOW = 15 * 60_000

function globalState() {
  try {
    return JSON.parse(getSetting('login_fails') ?? '{}') as { start?: number; n?: number }
  } catch {
    return {}
  }
}

/** Кинути 429, якщо з цієї адреси (чи загалом, для пароля) забагато невдалих спроб. */
export function checkAttempts(req: IncomingMessage, password = false) {
  const f = fails.get(clientIp(req))
  if (f && f.until > Date.now()) throw new HttpError(429, 'Забагато спроб. Спробуй за хвилину.')
  if (!password) return
  const g = globalState()
  if ((g.n ?? 0) >= GLOBAL_FAILS && Date.now() - (g.start ?? 0) < GLOBAL_WINDOW) {
    throw new HttpError(429, 'Забагато невдалих спроб. Вхід за паролем призупинено на 15 хвилин.')
  }
}

export function recordFailure(req: IncomingMessage, password = false) {
  const ip = clientIp(req)
  const now = Date.now()
  if (fails.size >= MAX_TRACKED && !fails.has(ip)) {
    for (const [k, v] of fails) if (now - v.at > 10 * 60_000) fails.delete(k)
    if (fails.size >= MAX_TRACKED) fails.delete(fails.keys().next().value!)
  }
  const n = (fails.get(ip)?.n ?? 0) + 1
  fails.set(ip, { n, until: n >= 5 ? now + 60_000 : 0, at: now })
  if (!password) return
  const g = globalState()
  const fresh = !g.start || now - g.start > GLOBAL_WINDOW
  setSetting('login_fails', JSON.stringify(fresh ? { start: now, n: 1 } : { start: g.start, n: (g.n ?? 0) + 1 }))
}

export const recordSuccess = (req: IncomingMessage) => void fails.delete(clientIp(req))
