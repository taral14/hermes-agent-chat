// Єдиний шлях до API сервера: JSON, помилки з кодом статусу і вихід на екран входу, коли сесія закінчилась.
import { emit } from './bus.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Тут 401 — це відповідь на сам вхід або публічна сторінка, а не кінець сесії. */
const NO_SESSION = /^\/api\/(login|auth\/passkey\/|auth\/methods|public\/)/

type Options = { body?: unknown; raw?: BodyInit; headers?: Record<string, string> }

export async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const json = opts.body !== undefined
  const res = await fetch(path, {
    method,
    headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: json ? JSON.stringify(opts.body) : opts.raw,
    credentials: 'same-origin',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    if (res.status === 401 && !NO_SESSION.test(path)) emit('unauthorized')
    throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`)
  }
  return data
}
