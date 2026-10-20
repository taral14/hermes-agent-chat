// Підключення до рідного протоколу Hermes gateway через міст bridge.py (офіційний клієнт Hermes).
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { HERMES_AGENT_DIR, HERMES_HOME, HERMES_PYTHON } from './config.ts'

const HERMES = HERMES_AGENT_DIR
const PYTHON = HERMES_PYTHON
const BRIDGE = join(import.meta.dirname, 'bridge.py')

export class GatewayError extends Error {
  reason: string
  code: number | null
  data: Record<string, unknown>
  constructor(reason: string, message?: string, code: number | null = null, data: Record<string, unknown> = {}) {
    super(message || reason)
    this.reason = reason
    this.code = code
    this.data = data
  }
}

/** Конверт події gateway: {type, session_id, admission_id, execution_generation, payload, sequence, ...}. */
export type GatewayEvent = {
  type: string
  session_id?: string
  admission_id?: string
  execution_generation?: number
  sequence?: number
  replay_epoch?: string
  payload?: Record<string, unknown>
} & Record<string, unknown>

/** Відповідь HTTP-маршруту gateway: тіло — JSON, якщо воно розібралось, інакше текст. */
export type HttpReply<T = unknown> = { status: number; body: T }

export type ServerRequest = { id: string; method: string; params: Record<string, unknown> }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

type Listeners = {
  event: (e: GatewayEvent) => void
  request: (r: ServerRequest) => void
  /** Міст (пере)підключився: треба знову підписатися на потрібні сесії. */
  connected: () => void
}

class Gateway {
  private child: ChildProcessWithoutNullStreams | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private readyWaiters: (() => void)[] = []
  private ready = false
  private backoff = 1000
  private stopped = false
  private listeners: Listeners = { event: () => {}, request: () => {}, connected: () => {} }
  /** Сесії, на які підписаний поточний міст (після перезапуску — порожньо). */
  attached = new Set<string>()

  /** Міст до Hermes піднятий і готовий приймати запити. */
  get connected() {
    return this.ready
  }

  /** Підняти міст, якщо він ще не працює (він стартує лише на першу дію), і сказати, чи вдалося. */
  async check(timeoutMs = 6000): Promise<boolean> {
    try {
      await this.whenReady(timeoutMs)
      return true
    } catch {
      return false
    }
  }

  on(l: Partial<Listeners>) {
    this.listeners = { ...this.listeners, ...l }
  }

  start() {
    if (this.child || this.stopped) return
    const child = spawn(PYTHON, [BRIDGE], {
      cwd: HERMES,
      env: { ...process.env, PYTHONPATH: HERMES, HERMES_HOME, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.ready = false
    this.attached.clear()
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => this.onLine(line))
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString().trim()
      if (text) console.warn(`[gateway-bridge] ${text.slice(0, 500)}`)
    })
    // Без обробників 'error' невдалий запуск Python (ENOENT) чи запис у мертвий міст (EPIPE) кладе весь сервер.
    let gone = false
    const down = (why: string) => {
      if (gone) return
      gone = true
      if (this.child === child) this.child = null
      this.ready = false
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new GatewayError('disconnected', 'Зв’язок із Hermes обірвався'))
        this.pending.delete(id)
      }
      if (this.stopped) return
      console.warn(`[gateway] міст завершився (${why}), перепідключаюсь за ${this.backoff / 1000} с`)
      setTimeout(() => this.start(), this.backoff).unref()
      this.backoff = Math.min(this.backoff * 2, 30_000)
    }
    child.on('error', (err) => down(err.message))
    child.stdin.on('error', () => child.kill())
    child.on('exit', (code) => down(`код ${code}`))
  }

  stop() {
    this.stopped = true
    this.child?.stdin.end()
    this.child?.kill()
  }

  private onLine(line: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.ready) {
      this.ready = true
      this.backoff = 1000
      for (const w of this.readyWaiters.splice(0)) w()
      this.listeners.connected()
      return
    }
    if (msg.closed) {
      console.warn(`[gateway] з’єднання закрито: ${String(msg.closed)}`)
      this.child?.kill()
      return
    }
    if (msg.event) return this.listeners.event(msg.event as GatewayEvent)
    if (msg.request) return this.listeners.request(msg.request as ServerRequest)
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) {
        const e = msg.error as { reason?: string; message?: string; code?: number; data?: Record<string, unknown> }
        p.reject(new GatewayError(e.reason ?? 'error', e.message ?? e.reason, e.code ?? null, e.data ?? {}))
      } else p.resolve(msg.result)
    }
  }

  private whenReady(timeoutMs: number): Promise<void> {
    if (this.ready) return Promise.resolve()
    this.start()
    return new Promise((resolve, reject) => {
      const w = () => {
        clearTimeout(t)
        resolve()
      }
      const t = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((x) => x !== w)
        reject(new GatewayError('unavailable', 'Hermes gateway недоступний'))
      }, timeoutMs)
      this.readyWaiters.push(w)
    })
  }

  async rpc<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    return this.call<T>({ method, params }, method, timeoutMs)
  }

  /** HTTP-маршрут gateway (/api/mcp/… тощо). Міст сам додає одноразовий квиток; статус повертається як є. */
  async http<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = 30_000): Promise<HttpReply<T>> {
    return this.call<HttpReply<T>>({ http: { method, path, body: body ?? null } }, `${method} ${path}`, timeoutMs)
  }

  /** Блок mcp_servers.<name> для запису каталогу Hermes (з фільтром інструментів), без запису в конфіг. */
  async catalogConfig(name: string): Promise<Record<string, unknown>> {
    return this.call({ catalog: name }, `каталог ${name}`, 30_000)
  }

  private async call<T>(payload: Record<string, unknown>, what: string, timeoutMs: number): Promise<T> {
    await this.whenReady(20_000)
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayError('timeout', `Hermes не відповів на ${what}`))
      }, timeoutMs + 2000)
      if (!this.child) {
        clearTimeout(timer)
        return reject(new GatewayError('disconnected', 'Зв’язок із Hermes обірвався'))
      }
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, ...payload, timeout: timeoutMs / 1000 }) + '\n')
    })
  }

  respond(requestId: string, result: unknown, error?: { code: number; message: string }) {
    if (!this.child) return
    this.child.stdin.write(JSON.stringify(error ? { respond: requestId, error } : { respond: requestId, result }) + '\n')
  }

  /** Підписка на сесію (resume). Повертає знімок сесії. Повторна підписка в межах одного мосту — без запиту. */
  async attach(sessionId: string, force = false): Promise<Record<string, unknown> | null> {
    if (!force && this.attached.has(sessionId)) return null
    const snap = await this.rpc('session.resume', { session_id: sessionId })
    this.attached.add(sessionId)
    return snap
  }
}

export const gateway = new Gateway()
