// Усе, що залежить від машини й домену, в одному місці. Значення беруться зі змінних оточення;
// `npm start` і `npm run dev` підвантажують їх із файлу .env поруч із package.json (див. .env.example).
// За замовчуванням чат працює на http://localhost:5190 з Hermes у ~/.hermes.
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'

const env = (k: string) => process.env[k]?.trim() || undefined
const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir())

export const ROOT = resolve(import.meta.dirname, '..')
export const PORT = Number(env('PORT') ?? 5190)
/** На якій адресі слухати. За замовчуванням лише цей комп'ютер: назовні — через проксі чи тунель з HTTPS. */
export const BIND_HOST = env('BIND_HOST') ?? '127.0.0.1'

/** Домен, на якому чат відкривають у браузері (chat.example.com). Від нього залежать ключі доступу, посилання й пуші. */
export const PUBLIC_HOST = (env('PUBLIC_HOST') ?? 'localhost').toLowerCase()
export const PUBLIC_URL = (env('PUBLIC_URL') ?? (PUBLIC_HOST === 'localhost' ? `http://localhost:${PORT}` : `https://${PUBLIC_HOST}`)).replace(/\/+$/, '')

/** Тека Hermes (як HERMES_HOME у самого Hermes): .env, config.yaml, кеш, код агента. */
export const HERMES_HOME = expand(env('HERMES_HOME') ?? join(homedir(), '.hermes'))
export const hermesPath = (...parts: string[]) => join(HERMES_HOME, ...parts)
export const HERMES_AGENT_DIR = expand(env('HERMES_AGENT_DIR') ?? env('HERMES_HOME_AGENT') ?? hermesPath('hermes-agent'))
export const HERMES_PYTHON = expand(env('HERMES_PYTHON') ?? join(HERMES_AGENT_DIR, 'venv', 'bin', 'python'))
/** API-сервер Hermes (Runs API, задачі за розкладом). */
export const HERMES_URL = (env('HERMES_URL') ?? 'http://127.0.0.1:8642').replace(/\/+$/, '')
/** Панель Hermes, якщо вона відкрита назовні: посилання в налаштуваннях. Порожньо — посилання не показуємо. */
export const HERMES_PANEL_URL = env('HERMES_PANEL_URL') ?? ''

/**
 * Роутер, що запускає чат на вимогу й зупиняє після простою (як у монорепо web).
 * Якщо задано, поки Hermes працює, чат раз на 5 хвилин стукає до себе через нього, щоб його не зупинили.
 */
export const ROUTER_URL = (env('ROUTER_URL') ?? '').replace(/\/+$/, '')

/** Контакт для служб пушів (VAPID): mailto: або https-адреса. */
export const VAPID_SUBJECT = env('VAPID_SUBJECT') ?? (PUBLIC_URL.startsWith('https://') ? PUBLIC_URL : 'mailto:hermes-chat@localhost')

export const IS_MAC = platform() === 'darwin'
