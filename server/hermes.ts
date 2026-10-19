// Клієнт до API-сервера Hermes Agent (127.0.0.1:8642): назви сесій, моделі, задачі за розкладом.
// Самі розмови йдуть рідним протоколом gateway (gateway.ts, native.ts).
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { ModelOptions } from '../src/shared.ts'
import { HERMES_URL, hermesPath } from './config.ts'

const BASE = HERMES_URL

/** Ключ API-сервера читаємо з ~/.hermes/.env щоразу, щоб зміна ключа не вимагала перезапуску. */
function apiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY
  const env = readFileSync(hermesPath('.env'), 'utf8')
  const m = env.match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)
  if (!m) throw new Error('API_SERVER_KEY не знайдено в ~/.hermes/.env')
  return m[1]!
}

export class HermesError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    throw new HermesError(0, `Hermes недоступний: ${(err as Error).message}`, 'unreachable')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: string } | string; detail?: string } | null) ?? {}
    const err = typeof e.error === 'object' ? e.error : undefined
    const msg = err?.message ?? (typeof e.error === 'string' ? e.error : e.detail) ?? `HTTP ${res.status}`
    throw new HermesError(res.status, msg, err?.code ?? '')
  }
  return data as T
}

export async function sessionTitle(sessionId: string): Promise<string | null> {
  try {
    const r = await call<{ session?: { title?: string | null } }>('GET', `/api/sessions/${encodeURIComponent(sessionId)}`)
    const t = r.session?.title?.trim()
    return t && t !== 'Untitled' ? t : null
  } catch {
    return null
  }
}

/** agent.reasoning_effort з ~/.hermes/config.yaml (за замовчуванням medium). */
export function defaultEffort(): string {
  try {
    const cfg = parseYaml(readFileSync(hermesPath('config.yaml'), 'utf8')) as { agent?: { reasoning_effort?: unknown } }
    const v = String(cfg?.agent?.reasoning_effort ?? '').trim()
    return v || 'medium'
  } catch {
    return 'medium'
  }
}

let modelCache: { at: number; value: ModelOptions } | null = null

export async function modelOptions(): Promise<ModelOptions> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.value
  const r = await call<{
    model: string
    provider: string
    providers: {
      slug: string
      name: string
      authenticated?: boolean
      models?: string[]
      capabilities?: Record<string, { reasoning?: boolean }>
    }[]
  }>('GET', '/api/model/options')
  const value: ModelOptions = {
    current: { provider: r.provider, model: r.model },
    defaultEffort: defaultEffort(),
    providers: r.providers
      .filter((p) => p.authenticated && p.models?.length)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        models: p.models!,
        reasoning: Object.fromEntries(Object.entries(p.capabilities ?? {}).map(([k, v]) => [k, Boolean(v?.reasoning)])),
      }))
      .sort((a, b) => Number(b.slug === r.provider) - Number(a.slug === r.provider)),
  }
  modelCache = { at: Date.now(), value }
  return value
}
