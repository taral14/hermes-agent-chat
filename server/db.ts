import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Attachment, Chat, Message, ModelChoice, Part, Usage } from '../src/shared.ts'

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

export function closeDb() {
  db.close()
}
