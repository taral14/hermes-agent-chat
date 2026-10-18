// Ключі доступу (WebAuthn) на клієнті: вхід, автопідказка в полі логіна і реєстрація нових ключів.
import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'

export type PasskeyInfo = { id: string; name: string; kind: 'device' | 'security-key'; backedUp: boolean; createdAt: number; lastUsedAt: number | null }
export type Security = { passkeys: PasskeyInfo[]; passwordLogin: boolean; autoApprove: boolean }

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Помилка ${res.status}`)
  return data
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Помилка ${res.status}`)
  return data
}

export const supported = () => browserSupportsWebAuthn()

/** Людська помилка замість технічної: скасування, таймаут, не той ключ. */
function friendly(err: unknown): Error {
  const e = err as Error & { name?: string; code?: string }
  if (e.name === 'NotAllowedError' || e.code === 'ERROR_CEREMONY_ABORTED') return new Error('Скасовано або час вийшов')
  if (e.name === 'InvalidStateError' || e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return new Error('Цей ключ уже додано')
  if (e.name === 'AbortError') return new Error('Скасовано')
  return e instanceof Error ? e : new Error(String(e))
}

export const methods = () => call<{ passkeys: boolean; password: boolean }>('GET', '/api/auth/methods')

export async function login(): Promise<void> {
  const { options, challengeId } = await post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>('/api/auth/passkey/options', { autofill: false })
  let response
  try {
    response = await startAuthentication({ optionsJSON: options })
  } catch (err) {
    throw friendly(err)
  }
  await post('/api/auth/passkey/login', { challengeId, response })
}

/** Автопідказка ключа в полі логіна (iPhone показує його над клавіатурою). Повертає true після входу. */
export async function autofillLogin(): Promise<boolean> {
  if (!(await browserSupportsWebAuthnAutofill())) return false
  const { options, challengeId } = await post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>('/api/auth/passkey/options', { autofill: true })
  try {
    const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true })
    await post('/api/auth/passkey/login', { challengeId, response })
    return true
  } catch {
    return false
  }
}

export const cancelPending = () => WebAuthnAbortService.cancelCeremony()

export const security = () => call<Security>('GET', '/api/auth/security')

export async function register(kind: 'device' | 'security-key'): Promise<Security> {
  cancelPending()
  const { options, challengeId } = await post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/api/auth/passkeys/options', { kind })
  let response
  try {
    response = await startRegistration({ optionsJSON: options })
  } catch (err) {
    throw friendly(err)
  }
  return post<Security>('/api/auth/passkeys', { challengeId, response })
}

export const rename = (id: string, name: string) => call<Security>('PATCH', `/api/auth/passkeys/${id}`, { name })
export const remove = (id: string) => call<Security>('DELETE', `/api/auth/passkeys/${id}`)
export const setAutoApprove = (enabled: boolean) => post<Security>('/api/auth/auto-approve', { enabled })
export const setPasswordLogin = (enabled: boolean) => post<Security>('/api/auth/password-login', { enabled })
