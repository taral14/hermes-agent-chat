import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Attachment, Chat, Message, ModelChoice, Part, PushSettings, Usage } from '../src/shared.ts'

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

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v == null ? fallback : (JSON.parse(String(v)) as T)
  } catch {
    return fallback
  }
}

export type ChatRow = Chat & { sessionId: string; titleSource: string }
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
export function publicChat({ sessionId: _s, titleSource: _t, ...chat }: ChatRow): Chat {
  return chat
}
export function publicMessage({ runId: _r, lastSeq: _l, ...msg }: MessageRow): Message {
  return msg
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

export function createChat(id: string, sessionId: string, model: ModelChoice): ChatRow {
  const now = Date.now()
  db.prepare('INSERT INTO chats (id, session_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    sessionId,
    model ? JSON.stringify(model) : null,
    now,
    now,
  )
  return getChat(id)!
}

export function updateChat(
  id: string,
  patch: { title?: string; titleSource?: string; pinned?: boolean; model?: ModelChoice; touch?: boolean },
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
  if (patch.touch) {
    sets.push('updated_at = ?')
    args.push(Date.now())
  }
  if (!sets.length) return
  db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
}

export function deleteChat(id: string) {
  db.prepare('DELETE FROM chats WHERE id = ?').run(id)
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
  db.prepare('INSERT INTO uploads (id, name, mime, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    u.id,
    u.name,
    u.mime,
    u.size,
    u.path,
    Date.now(),
  )
}

export function getUpload(id: string): UploadRow | null {
  const r = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id)
  return r ? { id: str(r.id), name: str(r.name), mime: str(r.mime), size: Number(r.size), path: str(r.path) } : null
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
    .map((r) => ({ id: str(r.id), name: str(r.name), mime: str(r.mime), size: Number(r.size), path: str(r.path) }))
}

export function deleteUploadRow(id: string) {
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
}

export function closeDb() {
  db.close()
}
