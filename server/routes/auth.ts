// Вхід і безпека: пароль, ключі доступу (passkeys), сесії на пристроях.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { type PasskeyRow, deleteLoginSession, deleteOtherLoginSessions, deletePasskey, listLoginSessions, listPasskeys, renamePasskey, setSetting } from '../db.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { PasskeyError, loginOptions, loginVerify, passwordLoginAllowed, registerVerify, registrationOptions } from '../passkeys.ts'
import { LOGOUT_COOKIE, checkAttempts, loadConfig, loginCookie, recordFailure, recordSuccess, same, sessionId } from '../session.ts'

/** Помилки ключів — це 400 з поясненням, а не 500. */
async function passkeyErrors<T>(fn: () => Promise<T>, prefix: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) throw err
    if (err instanceof PasskeyError) throw new HttpError(400, err.message)
    throw new HttpError(400, `${prefix}: ${(err as Error).message}`)
  }
}

/** Маршрути, що працюють без входу. */
export async function loginRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path === '/api/login' && method === 'POST') {
    checkAttempts(req, true)
    const { username, password } = await readJson<{ username?: string; password?: string }>(req)
    const cfg = loadConfig()
    if (!passwordLoginAllowed() && !cfg.allowPassword) throw new HttpError(403, 'Вхід за паролем вимкнено. Увійди з ключем.')
    if (!same(String(username ?? '').trim(), cfg.username) || !same(String(password ?? ''), cfg.password)) {
      recordFailure(req, true)
      throw new HttpError(401, 'Неправильний логін або пароль')
    }
    recordSuccess(req)
    return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req) })
  }
  if (path === '/api/auth/methods') {
    return send(res, 200, { passkeys: listPasskeys().length > 0, password: passwordLoginAllowed() || loadConfig().allowPassword })
  }
  if (path === '/api/auth/passkey/options' && method === 'POST') {
    checkAttempts(req)
    const b = await readJson<{ autofill?: boolean }>(req)
    return send(res, 200, await passkeyErrors(() => loginOptions(req, Boolean(b.autofill)), 'Ключ не підійшов'))
  }
  if (path === '/api/auth/passkey/login' && method === 'POST') {
    checkAttempts(req)
    const b = await readJson<{ challengeId?: string; response?: AuthenticationResponseJSON }>(req)
    if (!b.response) throw new HttpError(400, 'Немає відповіді ключа')
    try {
      await passkeyErrors(() => loginVerify(b.challengeId, b.response!), 'Ключ не підійшов')
    } catch (err) {
      recordFailure(req)
      throw err
    }
    recordSuccess(req)
    return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req) })
  }
  if (path === '/api/logout' && method === 'POST') {
    const sid = sessionId(req)
    if (sid) deleteLoginSession(sid)
    return send(res, 200, { ok: true }, { 'Set-Cookie': LOGOUT_COOKIE })
  }
  return false
}

const pub = (k: PasskeyRow) => ({ id: k.id, name: k.name, kind: k.kind, backedUp: k.backedUp, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })

/** «Вхід і безпека» в налаштуваннях: ключі, сесії, вхід за паролем. Лише після входу. */
export async function accountRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path === '/api/me') return send(res, 200, { username: loadConfig().username })
  if (!path.startsWith('/api/auth/')) return false
  const sid = sessionId(req)
  const security = () => ({
    passkeys: listPasskeys().map(pub),
    passwordLogin: passwordLoginAllowed(),
    sessions: listLoginSessions().map((x) => ({ id: x.id.slice(0, 8), createdAt: x.createdAt, lastSeen: x.lastSeen, ua: x.ua, ip: x.ip, current: x.id === sid })),
  })
  if (path === '/api/auth/security' && method === 'GET') return send(res, 200, security())
  if (path === '/api/auth/passkeys/options' && method === 'POST') {
    const b = await readJson<{ kind?: string }>(req)
    const kind = b.kind === 'security-key' ? 'security-key' : 'device'
    return send(res, 200, await passkeyErrors(() => registrationOptions(req, loadConfig().username, kind), 'Не вдалося'))
  }
  if (path === '/api/auth/passkeys' && method === 'POST') {
    const b = await readJson<{ challengeId?: string; response?: RegistrationResponseJSON; name?: string }>(req)
    if (!b.response) throw new HttpError(400, 'Немає відповіді ключа')
    await passkeyErrors(() => registerVerify(req, b.challengeId, b.response!, b.name), 'Не вдалося')
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
  return false
}
