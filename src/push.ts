// Веб-пуші на клієнті: service worker, підписка, присутність (щоб не пушити те, що людина й так бачить).
import type { PushSettings } from './shared.ts'

const json = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Помилка ${res.status}`)
  return data
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

let registration: Promise<ServiceWorkerRegistration | null> | null = null

export function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  registration ??= navigator.serviceWorker.register('/sw.js').catch(() => null)
  return registration
}

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerSW()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function status(): Promise<PushSettings | null> {
  const sub = await currentSubscription()
  if (!sub) return null
  return json<PushSettings | null>('/api/push/status', { endpoint: sub.endpoint })
}

export async function enable(): Promise<PushSettings> {
  const reg = await registerSW()
  if (!reg) throw new Error('Браузер не дав зареєструвати service worker')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Сповіщення заборонені в налаштуваннях браузера')
  const { publicKey } = await json<{ publicKey: string }>('/api/push/key')
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  return json<PushSettings>('/api/push/subscribe', { subscription: sub.toJSON() })
}

export async function update(settings: Partial<PushSettings>) {
  const sub = await currentSubscription()
  if (!sub) throw new Error('Пристрій не підписаний')
  return json<PushSettings>('/api/push/settings', { endpoint: sub.endpoint, settings })
}

export async function test() {
  const sub = await currentSubscription()
  if (!sub) throw new Error('Пристрій не підписаний')
  await json('/api/push/test', { endpoint: sub.endpoint })
}

export async function disable() {
  const sub = await currentSubscription()
  if (!sub) return
  await json('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}

// ---------- Присутність ----------

const clientId = (() => {
  try {
    const k = 'chat-client-id'
    const v = sessionStorage.getItem(k) ?? Math.random().toString(36).slice(2)
    sessionStorage.setItem(k, v)
    return v
  } catch {
    return Math.random().toString(36).slice(2)
  }
})()

export function reportPresence(chatId: string | null) {
  const body = JSON.stringify({ clientId, visible: document.visibilityState === 'visible' && document.hasFocus(), chatId })
  if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/presence', new Blob([body], { type: 'application/json' }))
    return
  }
  fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {})
}
