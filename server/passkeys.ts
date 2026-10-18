// Вхід без пароля: ключі доступу (Face ID / Touch ID / iCloud) і фізичні ключі (YubiKey тощо) через WebAuthn.
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import {
  type PasskeyRow,
  getPasskey,
  getSetting,
  insertPasskey,
  listPasskeys,
  setSetting,
  touchPasskey,
} from './db.ts'

const RP_NAME = 'Hermes'
/** Домени, для яких дозволені ключі. localhost — для розробки. */
const RP_IDS = new Set([process.env.PUBLIC_HOST ?? 'chat.example.com', 'localhost'])

export class PasskeyError extends Error {}

/** rpID і origin беремо з адреси, на яку прийшов запит (роутер зберігає Host). */
export function relyingParty(req: IncomingMessage): { rpID: string; origin: string } {
  const host = String(req.headers.host ?? '')
  const rpID = host.split(':')[0]!.toLowerCase()
  if (!RP_IDS.has(rpID)) throw new PasskeyError('Ключі доступу працюють лише на chat.example.com')
  const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip']) || rpID !== 'localhost'
  return { rpID, origin: `${secure ? 'https' : 'http'}://${host}` }
}

// ---------- Виклики (challenge) живуть 5 хвилин ----------

type Pending = { challenge: string; rpID: string; origin: string; exp: number; kind?: 'device' | 'security-key' }
const pending = new Map<string, Pending>()

function remember(p: Omit<Pending, 'exp'>): string {
  const id = randomBytes(12).toString('base64url')
  pending.set(id, { ...p, exp: Date.now() + 5 * 60_000 })
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k)
  return id
}

function take(id: unknown): Pending {
  const p = typeof id === 'string' ? pending.get(id) : undefined
  if (typeof id === 'string') pending.delete(id)
  if (!p || p.exp < Date.now()) throw new PasskeyError('Час на підтвердження минув, спробуй ще раз')
  return p
}

/** Стабільний ідентифікатор єдиного користувача для автентифікаторів. */
function userID(): Uint8Array {
  let v = getSetting('webauthn_user_id')
  if (!v) {
    v = randomBytes(32).toString('base64url')
    setSetting('webauthn_user_id', v)
  }
  return new Uint8Array(Buffer.from(v, 'base64url'))
}

export const passwordLoginAllowed = () => getSetting('password_login') !== 'off' || listPasskeys().length === 0

// ---------- Реєстрація ----------

function deviceName(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'Пристрій'
}

export async function registrationOptions(req: IncomingMessage, username: string, kind: 'device' | 'security-key') {
  const rp = relyingParty(req)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: username,
    userDisplayName: username,
    userID: userID() as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: listPasskeys().map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: {
      // Фізичний ключ: просимо саме зовнішній автентифікатор (USB/NFC/Bluetooth).
      ...(kind === 'security-key' ? { authenticatorAttachment: 'cross-platform' as const } : {}),
      residentKey: kind === 'security-key' ? 'discouraged' : 'preferred',
      userVerification: 'preferred',
    },
    preferredAuthenticatorType: kind === 'security-key' ? 'securityKey' : 'localDevice',
  })
  return { options, challengeId: remember({ challenge: options.challenge, ...rp, kind }) }
}

export async function registerVerify(req: IncomingMessage, challengeId: unknown, response: RegistrationResponseJSON, name?: string) {
  const p = take(challengeId)
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: p.challenge,
    expectedOrigin: p.origin,
    expectedRPID: p.rpID,
    requireUserVerification: false,
  })
  if (!v.verified) throw new PasskeyError('Ключ не підтверджено')
  const info = v.registrationInfo
  const cross = response.authenticatorAttachment === 'cross-platform' || p.kind === 'security-key'
  const kind: PasskeyRow['kind'] = cross && info.credentialDeviceType === 'singleDevice' ? 'security-key' : 'device'
  const ua = String(req.headers['user-agent'] ?? '')
  const fallback = kind === 'security-key' ? 'Фізичний ключ' : `${deviceName(ua)}${info.credentialBackedUp ? ' · синхронізується' : ''}`
  const row: PasskeyRow = {
    id: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: response.response.transports ?? info.credential.transports ?? [],
    name: (name ?? '').trim().slice(0, 60) || fallback,
    kind,
    backedUp: info.credentialBackedUp,
    createdAt: Date.now(),
    lastUsedAt: null,
  }
  if (getPasskey(row.id)) throw new PasskeyError('Цей ключ уже додано')
  insertPasskey(row)
  return row
}

// ---------- Вхід ----------

export async function loginOptions(req: IncomingMessage, autofill: boolean) {
  const rp = relyingParty(req)
  const keys = listPasskeys()
  if (!keys.length) throw new PasskeyError('Ще немає жодного ключа')
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    // Для кнопки «Увійти з ключем» перелічуємо всі ключі, щоб працювали й фізичні ключі без resident-ключа.
    // Автозаповнення (conditional UI) вимагає порожнього списку.
    allowCredentials: autofill ? [] : keys.map((k) => ({ id: k.id, transports: k.transports })),
    userVerification: 'preferred',
  })
  return { options, challengeId: remember({ challenge: options.challenge, ...rp }) }
}

export async function loginVerify(challengeId: unknown, response: AuthenticationResponseJSON): Promise<PasskeyRow> {
  const p = take(challengeId)
  const key = getPasskey(response.id)
  if (!key) throw new PasskeyError('Цей ключ тут не зареєстровано')
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: p.challenge,
    expectedOrigin: p.origin,
    expectedRPID: p.rpID,
    credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')) as Uint8Array<ArrayBuffer>, counter: key.counter, transports: key.transports },
    requireUserVerification: false,
  })
  if (!v.verified) throw new PasskeyError('Ключ не підтверджено')
  touchPasskey(key.id, v.authenticationInfo.newCounter)
  return key
}
