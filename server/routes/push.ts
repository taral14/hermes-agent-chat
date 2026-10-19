// Пуш-сповіщення: підписка пристрою, його налаштування, тест.
import { DEFAULT_PUSH, type PushSettings, deletePushSub, getPushSub, savePushSub } from '../db.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { VAPID_PUBLIC, sendTest } from '../push.ts'

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

const clean = (x?: Partial<PushSettings>): Partial<PushSettings> =>
  Object.fromEntries(Object.entries(x ?? {}).filter(([k, v]) => k in DEFAULT_PUSH && typeof v === 'boolean'))

export async function pushRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path === '/api/push/key') return send(res, 200, { publicKey: VAPID_PUBLIC })
  if (!path.startsWith('/api/push/') || method !== 'POST') return false
  const b = await readJson<{
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    endpoint?: string
    settings?: Partial<PushSettings>
  }>(req)
  const endpoint = b.subscription?.endpoint ?? b.endpoint ?? ''
  if (!pushHostAllowed(endpoint)) throw new HttpError(400, 'Немає підписки')
  const action = path.slice('/api/push/'.length)
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
  return false
}
