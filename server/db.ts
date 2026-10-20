import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Attachment, Chat, ChatList, ChatMode, Message, ModelChoice, Part, PushSettings, Usage } from '../src/shared.ts'

export type { PushSettings }

export const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data')
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'chat.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    title_source TEXT NOT NULL DEFAULT 'none',
    pinned INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    parts TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    error TEXT,
    usage TEXT,
    model TEXT,
    run_id TEXT,
    last_seq INTEGER NOT NULL DEFAULT -1,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created_at);
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    ua TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`)

// ---------- Міграції ----------
// Версія схеми — у PRAGMA user_version. Кожна міграція виконується раз, у транзакції; нові дописуються в кінець.
// Версія 1 — усе, що бази до версіонування отримували «спробою» (тому там ігноруємо «колонка вже є»).

const LEGACY = [
  `ALTER TABLE chats ADD COLUMN engine TEXT NOT NULL DEFAULT 'api'`,
  `ALTER TABLE chats ADD COLUMN control TEXT`,
  `ALTER TABLE chats ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE chats ADD COLUMN list_id TEXT`,
  `ALTER TABLE uploads ADD COLUMN ref INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS download_links (token TEXT PRIMARY KEY, upload_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS link_previews (url TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, upto INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '')`,
]

const MIGRATIONS: (() => void)[] = [
  () => {
    for (const sql of LEGACY) {
      try {
        db.exec(sql)
      } catch (err) {
        if (!/duplicate column/i.test((err as Error).message)) throw err
      }
    }
  },
  // 2: переклади описів (ключ — хеш мови й тексту), щоб кожен текст перекладати один раз.
  () => db.exec(`CREATE TABLE translations (key TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL)`),
]

function migrate() {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (current > MIGRATIONS.length) {
    throw new Error(`База даних новіша за цю версію чату (схема ${current}, підтримується до ${MIGRATIONS.length}). Онови чат.`)
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      MIGRATIONS[v]!()
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
migrate()

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v == null ? fallback : (JSON.parse(String(v)) as T)
  } catch {
    return fallback
  }
}

export type ChatRow = Chat & { sessionId: string; titleSource: string; engine: 'api' | 'native' }
export type MessageRow = Message & { runId: string | null; lastSeq: number }

function toChat(r: Row): ChatRow {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    title: str(r.title),
    titleSource: str(r.title_source),
    pinned: Boolean(r.pinned),
    model: json<ModelChoice>(r.model, null),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    running: Boolean(r.running),
    engine: str(r.engine) === 'native' ? 'native' : 'api',
    mode: (['ask', 'auto', 'plan'].includes(str(r.mode)) ? str(r.mode) : 'auto') as ChatMode,
    listId: r.list_id == null ? null : str(r.list_id),
    control: json<Chat['control']>(r.control, null),
  }
}

function toMessage(r: Row): MessageRow {
  return {
    id: str(r.id),
    chatId: str(r.chat_id),
    role: str(r.role) as Message['role'],
    text: str(r.text),
    attachments: json<Attachment[]>(r.attachments, []),
    parts: json<Part[]>(r.parts, []),
    status: str(r.status) as Message['status'],
    error: r.error == null ? null : str(r.error),
    usage: json<Usage | null>(r.usage, null),
    model: r.model == null ? null : str(r.model),
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
    runId: r.run_id == null ? null : str(r.run_id),
    lastSeq: Number(r.last_seq),
  }
}

/** Публічна форма без службових полів. */
export function publicChat({ sessionId: _s, titleSource: _t, engine, ...chat }: ChatRow): Chat {
  return { ...chat, native: engine === 'native' }
}
export function publicMessage({ runId, lastSeq: _l, ...msg }: MessageRow): Message {
  return { ...msg, turn: Boolean(runId) }
}

const RUNNING = `EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.status IN ('queued','running','stopping'))`

export function listChats(): ChatRow[] {
  return db
    .prepare(`SELECT c.*, ${RUNNING} AS running FROM chats c ORDER BY c.pinned DESC, c.updated_at DESC`)
    .all()
    .map(toChat)
}

export function getChat(id: string): ChatRow | null {
  const r = db.prepare(`SELECT c.*, ${RUNNING} AS running FROM chats c WHERE c.id = ?`).get(id)
  return r ? toChat(r) : null
}

export function createChat(id: string, sessionId: string, model: ModelChoice, engine: 'api' | 'native' = 'native'): ChatRow {
  const now = Date.now()
  db.prepare('INSERT INTO chats (id, session_id, model, engine, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    sessionId,
    model ? JSON.stringify(model) : null,
    engine,
    now,
    now,
  )
  return getChat(id)!
}

export function getChatBySession(sessionId: string): ChatRow | null {
  const r = db.prepare(`SELECT c.*, ${RUNNING} AS running FROM chats c WHERE c.session_id = ?`).get(sessionId)
  return r ? toChat(r) : null
}

export function deleteMessagesFrom(chatId: string, createdAt: number) {
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND created_at >= ?').run(chatId, createdAt)
}

export function updateChat(
  id: string,
  patch: { title?: string; titleSource?: string; pinned?: boolean; model?: ModelChoice; touch?: boolean; sessionId?: string; control?: Chat['control']; mode?: ChatMode; listId?: string | null },
) {
  const sets: string[] = []
  const args: (string | number | null)[] = []
  if (patch.title !== undefined) {
    sets.push('title = ?')
    args.push(patch.title)
  }
  if (patch.titleSource !== undefined) {
    sets.push('title_source = ?')
    args.push(patch.titleSource)
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?')
    args.push(patch.pinned ? 1 : 0)
  }
  if (patch.model !== undefined) {
    sets.push('model = ?')
    args.push(patch.model ? JSON.stringify(patch.model) : null)
  }
  if (patch.sessionId !== undefined) {
    sets.push('session_id = ?')
    args.push(patch.sessionId)
  }
  if (patch.listId !== undefined) {
    sets.push('list_id = ?')
    args.push(patch.listId)
  }
  if (patch.mode !== undefined) {
    sets.push('mode = ?')
    args.push(patch.mode)
  }
  if (patch.control !== undefined) {
    sets.push('control = ?')
    args.push(patch.control ? JSON.stringify(patch.control) : null)
  }
  if (patch.touch) {
    sets.push('updated_at = ?')
    args.push(Date.now())
  }
  if (!sets.length) return
  db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
}

export function deleteChat(id: string) {
  db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  db.prepare('DELETE FROM shares WHERE chat_id = ?').run(id)
}

export function listMessages(chatId: string): MessageRow[] {
  return db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid').all(chatId).map(toMessage)
}

export function getMessage(id: string): MessageRow | null {
  const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
  return r ? toMessage(r) : null
}

export function activeMessages(): MessageRow[] {
  return db.prepare(`SELECT * FROM messages WHERE status IN ('queued','running','stopping')`).all().map(toMessage)
}

/** Завершені відповіді без вкладень, де може ховатися шлях до файлу. */
export function answersWithoutFiles(): MessageRow[] {
  return db
    .prepare(`SELECT * FROM messages WHERE role = 'assistant' AND attachments = '[]' AND status = 'done' AND text LIKE '%/%'`)
    .all()
    .map(toMessage)
}

export function insertMessage(m: MessageRow) {
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, text, attachments, parts, status, error, usage, model, run_id, last_seq, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.id,
    m.chatId,
    m.role,
    m.text,
    JSON.stringify(m.attachments),
    JSON.stringify(m.parts),
    m.status,
    m.error,
    m.usage ? JSON.stringify(m.usage) : null,
    m.model,
    m.runId,
    m.lastSeq,
    m.createdAt,
    m.finishedAt,
  )
}

export function saveMessage(m: MessageRow) {
  db.prepare(
    `UPDATE messages SET text = ?, attachments = ?, parts = ?, status = ?, error = ?, usage = ?, model = ?, run_id = ?, last_seq = ?, finished_at = ?
     WHERE id = ?`,
  ).run(
    m.text,
    JSON.stringify(m.attachments),
    JSON.stringify(m.parts),
    m.status,
    m.error,
    m.usage ? JSON.stringify(m.usage) : null,
    m.model,
    m.runId,
    m.lastSeq,
    m.finishedAt,
    m.id,
  )
}

export type UploadRow = Attachment & { path: string }

export function insertUpload(u: UploadRow) {
  db.prepare('INSERT INTO uploads (id, name, mime, size, path, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    u.id,
    u.name,
    u.mime,
    u.size,
    u.path,
    u.ref ? 1 : 0,
    Date.now(),
  )
}

/** Тимчасове посилання на завантаження (без входу, до expires). */
export function createDownloadLink(token: string, uploadId: string, expiresAt: number) {
  db.prepare('DELETE FROM download_links WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT INTO download_links (token, upload_id, expires_at) VALUES (?, ?, ?)').run(token, uploadId, expiresAt)
}

export function resolveDownloadLink(token: string): UploadRow | null {
  const r = db.prepare('SELECT upload_id, expires_at FROM download_links WHERE token = ?').get(token) as
    | { upload_id: string; expires_at: number }
    | undefined
  if (!r || r.expires_at < Date.now()) return null
  return getUpload(r.upload_id)
}

export function getUpload(id: string): UploadRow | null {
  const r = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id)
  return r ? { id: str(r.id), name: str(r.name), mime: str(r.mime), size: Number(r.size), path: str(r.path), ...(r.ref ? { ref: true } : {}) } : null
}

/** Розмір і тип усіх файлів чату (для «Налаштування → Дані»). */
export function listUploads(): { size: number; ref: boolean }[] {
  return db.prepare('SELECT size, ref FROM uploads').all().map((r) => ({ size: Number(r.size), ref: Boolean(r.ref) }))
}

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string }; settings: PushSettings; ua: string }
export const DEFAULT_PUSH: PushSettings = { replies: true, prompts: true, jobs: false }

function toSub(r: Row): PushSub {
  return {
    endpoint: str(r.endpoint),
    keys: { p256dh: str(r.p256dh), auth: str(r.auth) },
    settings: { ...DEFAULT_PUSH, ...json<Partial<PushSettings>>(r.settings, {}) },
    ua: str(r.ua),
  }
}

export function listPushSubs(): PushSub[] {
  return db.prepare('SELECT * FROM push_subs').all().map(toSub)
}

export function getPushSub(endpoint: string): PushSub | null {
  const r = db.prepare('SELECT * FROM push_subs WHERE endpoint = ?').get(endpoint)
  return r ? toSub(r) : null
}

export function savePushSub(s: PushSub) {
  db.prepare(
    `INSERT INTO push_subs (endpoint, p256dh, auth, settings, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, settings = excluded.settings, ua = excluded.ua`,
  ).run(s.endpoint, s.keys.p256dh, s.keys.auth, JSON.stringify(s.settings), s.ua, Date.now())
}

export function deletePushSub(endpoint: string) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint)
}

export type PasskeyRow = {
  id: string
  publicKey: string
  counter: number
  transports: string[]
  name: string
  kind: 'device' | 'security-key'
  backedUp: boolean
  createdAt: number
  lastUsedAt: number | null
}

function toPasskey(r: Row): PasskeyRow {
  return {
    id: str(r.id),
    publicKey: str(r.public_key),
    counter: Number(r.counter),
    transports: json<string[]>(r.transports, []),
    name: str(r.name),
    kind: str(r.kind) === 'security-key' ? 'security-key' : 'device',
    backedUp: Boolean(r.backed_up),
    createdAt: Number(r.created_at),
    lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at),
  }
}

export function listPasskeys(): PasskeyRow[] {
  return db.prepare('SELECT * FROM passkeys ORDER BY created_at').all().map(toPasskey)
}

export function getPasskey(id: string): PasskeyRow | null {
  const r = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(id)
  return r ? toPasskey(r) : null
}

export function insertPasskey(p: PasskeyRow) {
  db.prepare(
    'INSERT INTO passkeys (id, public_key, counter, transports, name, kind, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(p.id, p.publicKey, p.counter, JSON.stringify(p.transports), p.name, p.kind, p.backedUp ? 1 : 0, p.createdAt)
}

export function touchPasskey(id: string, counter: number) {
  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(counter, Date.now(), id)
}

export function renamePasskey(id: string, name: string) {
  db.prepare('UPDATE passkeys SET name = ? WHERE id = ?').run(name, id)
}

export function deletePasskey(id: string) {
  db.prepare('DELETE FROM passkeys WHERE id = ?').run(id)
}

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return r ? str(r.value) : null
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ---------- Попередній перегляд посилань ----------

export function getTranslations(keys: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const q = db.prepare('SELECT text FROM translations WHERE key = ?')
  for (const k of keys) {
    const r = q.get(k) as { text: string } | undefined
    if (r) out.set(k, r.text)
  }
  return out
}

export function saveTranslation(key: string, text: string) {
  db.prepare('INSERT INTO translations (key, text, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text').run(key, text, Date.now())
}

export function getLinkPreview(url: string): { data: string; fetchedAt: number } | null {
  const r = db.prepare('SELECT data, fetched_at FROM link_previews WHERE url = ?').get(url)
  return r ? { data: str(r.data), fetchedAt: Number(r.fetched_at) } : null
}

export function saveLinkPreview(url: string, data: string) {
  db.prepare('INSERT INTO link_previews (url, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at').run(url, data, Date.now())
}

export function countLinkPreviews(): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM link_previews').get() as { n: number }).n)
}

export function clearLinkPreviews() {
  db.prepare('DELETE FROM link_previews').run()
}

// ---------- Спільний доступ до чатів ----------
// Посилання лише для перегляду: знімок чату до моменту `upto`. Новіші повідомлення не видно, доки власник не оновить посилання.

export type ShareRow = { token: string; chatId: string; upto: number; createdAt: number; updatedAt: number }

const shareRow = (r: Record<string, unknown>): ShareRow => ({
  token: str(r.token),
  chatId: str(r.chat_id),
  upto: Number(r.upto),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
})

export function getShareByChat(chatId: string): ShareRow | null {
  const r = db.prepare('SELECT * FROM shares WHERE chat_id = ?').get(chatId)
  return r ? shareRow(r) : null
}

export function getShare(token: string): ShareRow | null {
  const r = db.prepare('SELECT * FROM shares WHERE token = ?').get(token)
  return r ? shareRow(r) : null
}

/** Створити посилання або оновити наявне до поточного стану чату (токен лишається той самий). */
export function upsertShare(chatId: string, token: string, upto: number): ShareRow {
  const now = Date.now()
  db.prepare(
    'INSERT INTO shares (token, chat_id, upto, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET upto = excluded.upto, updated_at = excluded.updated_at',
  ).run(token, chatId, upto, now, now)
  return getShareByChat(chatId)!
}

export function listShares(): ShareRow[] {
  return db.prepare('SELECT * FROM shares ORDER BY updated_at DESC').all().map(shareRow)
}

export function deleteShare(chatId: string) {
  db.prepare('DELETE FROM shares WHERE chat_id = ?').run(chatId)
}

// ---------- Сесії входу ----------
// Кожен вхід — рядок у базі: вихід видаляє його, тож украдена cookie після виходу вже не працює.

export type SessionRow = { id: string; createdAt: number; lastSeen: number; expiresAt: number; ua: string; ip: string }

const sessionRow = (r: Record<string, unknown>): SessionRow => ({
  id: str(r.id),
  createdAt: Number(r.created_at),
  lastSeen: Number(r.last_seen),
  expiresAt: Number(r.expires_at),
  ua: str(r.ua),
  ip: str(r.ip),
})

export function createLoginSession(id: string, expiresAt: number, ua: string, ip: string) {
  const now = Date.now()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  db.prepare('INSERT INTO sessions (id, created_at, last_seen, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)').run(id, now, now, expiresAt, ua, ip)
}

export function getLoginSession(id: string): SessionRow | null {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return r ? sessionRow(r) : null
}

export function touchLoginSession(id: string, ip: string) {
  db.prepare('UPDATE sessions SET last_seen = ?, ip = ? WHERE id = ?').run(Date.now(), ip, id)
}

export function listLoginSessions(): SessionRow[] {
  return db.prepare('SELECT * FROM sessions WHERE expires_at > ? ORDER BY last_seen DESC').all(Date.now()).map(sessionRow)
}

export function deleteLoginSession(id: string) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteOtherLoginSessions(keep: string) {
  db.prepare('DELETE FROM sessions WHERE id != ?').run(keep)
}

/** Файли, на які ще посилаються повідомлення. */
function referencedUploads(): Set<string> {
  const ids = new Set<string>()
  for (const r of db.prepare(`SELECT attachments FROM messages WHERE attachments != '[]'`).all())
    for (const a of json<{ id: string }[]>(r.attachments, [])) ids.add(a.id)
  return ids
}

/** Завантаження, які вже нікому не потрібні: їхній чат видалено, або файл так і не надіслали за добу. */
export function orphanUploads(minAgeMs: number): UploadRow[] {
  const used = referencedUploads()
  return db
    .prepare('SELECT * FROM uploads WHERE created_at < ?')
    .all(Date.now() - minAgeMs)
    .filter((r) => !used.has(str(r.id)))
    .map((r) => ({ id: str(r.id), name: str(r.name), mime: str(r.mime), size: Number(r.size), path: str(r.path), ...(r.ref ? { ref: true } : {}) }))
}

/** Файл переїхав (фонова копія в сховище готова). Повертає, чи запис ще існує. */
export function setUploadPath(id: string, path: string): boolean {
  return Number(db.prepare('UPDATE uploads SET path = ? WHERE id = ?').run(path, id).changes) > 0
}

export function deleteUploadRow(id: string) {
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
}

// ---------- Списки чатів ----------

const LIST_COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1']

function toList(r: Row): ChatList {
  return { id: str(r.id), name: str(r.name), color: str(r.color), position: Number(r.position) }
}

export function listLists(): ChatList[] {
  return db.prepare('SELECT * FROM lists ORDER BY position, created_at').all().map(toList)
}

export function createList(id: string, name: string): ChatList {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }).n
  db.prepare('INSERT INTO lists (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, LIST_COLORS[n % LIST_COLORS.length]!, n, Date.now())
  return toList(db.prepare('SELECT * FROM lists WHERE id = ?').get(id)!)
}

export function updateList(id: string, patch: { name?: string; color?: string }) {
  if (patch.name !== undefined) db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(patch.name, id)
  if (patch.color !== undefined) db.prepare('UPDATE lists SET color = ? WHERE id = ?').run(patch.color, id)
}

/** Видалення списку не видаляє чати: вони повертаються в «Нещодавні». */
export function deleteList(id: string) {
  db.prepare('UPDATE chats SET list_id = NULL WHERE list_id = ?').run(id)
  db.prepare('DELETE FROM lists WHERE id = ?').run(id)
}

export function closeDb() {
  db.close()
}
