// HTTP-маршрути gateway Hermes (/api/mcp/…, /api/skills/…, /api/dashboard/…) через міст.
import { gateway } from './gateway.ts'
import { HttpError } from './http.ts'

/** Виклик маршруту gateway; помилка Hermes стає HttpError з його поясненням. */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const r = await gateway.http<T>(method, path, body, timeoutMs)
  if (r.status < 400) return r.body
  const b = r.body as unknown
  const detail = b && typeof b === 'object' && 'detail' in b ? (b as { detail: unknown }).detail : b
  const text = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'Hermes не прийняв запит' : `Hermes відповів ${r.status}`
  throw new HttpError(r.status === 404 || r.status === 409 || r.status === 400 ? r.status : 502, text.slice(0, 300))
}

/** Один сегмент шляху. */
export const seg = (name: string) => encodeURIComponent(name)

/** Помилка RPC Hermes → HttpError із текстом для людини (і хвостом журналу, якщо Hermes його дав). */
export function rpcFailure(err: unknown, fallback: string): HttpError {
  const e = err as { message?: string; data?: { log?: unknown } }
  const log = Array.isArray(e.data?.log) ? e.data.log.filter((l): l is string => typeof l === 'string') : []
  const text = [e.message || fallback, ...log.slice(-6)].join('\n').trim()
  return new HttpError(400, text.slice(0, 1200))
}
