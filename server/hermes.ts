// Клієнт до API-сервера Hermes Agent (gateway, 127.0.0.1:8642).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelOptions } from '../src/shared.ts'

const BASE = process.env.HERMES_URL ?? 'http://127.0.0.1:8642'

/** Ключ API-сервера читаємо з ~/.hermes/.env щоразу, щоб зміна ключа не вимагала перезапуску. */
function apiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY
  const env = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8')
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

export type InputContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[]

export type RunRequest = {
  sessionId: string
  input: InputContent
  idempotencyKey: string
  instructions?: string
  model?: { provider: string; model: string; effort?: string } | null
}

export async function startRun(req: RunRequest): Promise<string> {
  const body: Record<string, unknown> = {
    session_id: req.sessionId,
    input: typeof req.input === 'string' ? req.input : [{ role: 'user', content: req.input }],
  }
  if (req.instructions) body.instructions = req.instructions
  if (req.model) {
    body.provider = req.model.provider
    body.model = req.model.model
    if (req.model.effort) body.model_options = { reasoning_effort: req.model.effort }
  }
  const r = await call<{ run_id: string }>('POST', '/v1/runs', body, { 'Idempotency-Key': req.idempotencyKey })
  return r.run_id
}

export type RunStatus = {
  status: string
  output?: string
  error?: string
  usage?: Record<string, number>
  pending_controls?: Record<string, unknown>[]
}

export const getRun = (runId: string) => call<RunStatus>('GET', `/v1/runs/${encodeURIComponent(runId)}`)
export const stopRun = (runId: string) => call('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {})
export const steerRun = (runId: string, text: string) =>
  call('POST', `/v1/runs/${encodeURIComponent(runId)}/steer`, { input: text })
export const answerApproval = (runId: string, promptId: string, generation: number, choice: string) =>
  call('POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    request_id: promptId,
    execution_generation: generation,
    choice,
  })
export const answerClarify = (runId: string, promptId: string, generation: number, answer: string) =>
  call('POST', `/v1/runs/${encodeURIComponent(runId)}/clarify`, {
    request_id: promptId,
    execution_generation: generation,
    answer,
  })

export async function sessionTitle(sessionId: string): Promise<string | null> {
  try {
    const r = await call<{ session?: { title?: string | null } }>('GET', `/api/sessions/${encodeURIComponent(sessionId)}`)
    const t = r.session?.title?.trim()
    return t && t !== 'Untitled' ? t : null
  } catch {
    return null
  }
}

export async function renameSession(sessionId: string, title: string) {
  await call('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { title }).catch(() => {})
}

export async function deleteSession(sessionId: string) {
  await call('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`).catch(() => {})
}

/** Остання відповідь асистента з історії сесії (коли статус запуску вже забуто). */
export async function lastAssistantText(sessionId: string): Promise<string | null> {
  try {
    const r = await call<{ data: { role: string; content: unknown }[] }>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`,
    )
    for (let i = r.data.length - 1; i >= 0; i--) {
      const m = r.data[i]!
      if (m.role === 'user') return null
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content
    }
  } catch {
    /* немає сесії */
  }
  return null
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

export type HermesEvent = { event: string; seq?: number } & Record<string, unknown>

/**
 * Підписка на SSE подій запуску. Повертає, коли потік закрився (сам або через signal).
 * `lastSeq` — останній отриманий seq: Hermes дошле лише новіші події.
 */
export async function streamRunEvents(
  runId: string,
  lastSeq: number,
  onEvent: (e: HermesEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/events`, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'text/event-stream',
      ...(lastSeq >= 0 ? { 'Last-Event-ID': String(lastSeq) } : {}),
    },
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new HermesError(res.status, text.slice(0, 300) || `HTTP ${res.status}`)
  }
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk as Uint8Array, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      try {
        onEvent(JSON.parse(data) as HermesEvent)
      } catch {
        /* неповний або нестандартний кадр */
      }
    }
  }
}
