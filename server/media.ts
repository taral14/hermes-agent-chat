// Файли, які Hermes надсилає в чат: тег MEDIA:<шлях> (як у Telegram) або окремий рядок із шляхом до файлу.
import { randomBytes } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { Attachment } from '../src/shared.ts'
import { DATA_DIR, UPLOAD_DIR, deleteUploadRow, insertUpload, orphanUploads } from './db.ts'
import { HERMES_HOME, PUBLIC_HOST } from './config.ts'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Більші файли не копіюємо: зберігаємо шлях і віддаємо оригінал за тимчасовим посиланням. */
const REF_FROM = 25 * 1024 * 1024
const MAX_FILE = 200 * 1024 * 1024 * 1024

export const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.fb2': 'application/x-fictionbook+xml',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.aiff': 'audio/aiff',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.dmg': 'application/x-apple-diskimage',
  '.iso': 'application/x-iso9660-image',
  '.img': 'application/octet-stream',
  '.pkg': 'application/octet-stream',
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.key': 'application/x-iwork-keynote-sffkey',
  '.pages': 'application/x-iwork-pages-sffpages',
  '.numbers': 'application/x-iwork-numbers-sffnumbers',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.rtf': 'application/rtf',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
  '.log': 'text/plain',
  '.sqlite': 'application/vnd.sqlite3',
  '.db': 'application/vnd.sqlite3',
  '.gguf': 'application/octet-stream',
  '.safetensors': 'application/octet-stream',
}

export const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'

/** Те, що Hermes каже про файли в чаті. Додається до системного промпта кожного запуску. */
export const CHAT_INSTRUCTIONS = [
  `You are talking to the user through their private web chat (${PUBLIC_HOST}), which renders Markdown.`,
  'To deliver a file to the user (audio you synthesized, an image, video, PDF, document, archive, anything),',
  'put a line `MEDIA:/absolute/path/to/file` in your final answer, one line per file. The chat attaches the file',
  'to your message: audio and video get a player, images a preview, other files a download card.',
  'Do not paste the bare path or file contents instead, and do not explain how to open the file.',
  'Any size is fine (even many GB): large files are not copied, the user downloads the original by a temporary link,',
  'so never compress, split or move a file just to send it. Point MEDIA: at the file where it already is.',
  'Files the user attaches are saved on this Mac and listed with absolute paths in their message.',
  'When you create or mention a note in the Obsidian vault, refer to it by its path from the vault root in backticks',
  '(e.g. `Gaming/Note name.md`) or as [[Note name]]: the chat turns it into a clickable note card.',
].join(' ')

const HOME = homedir()
/** Секрети не віддаємо, навіть якщо модель про них згадала. */
// Файли із секретами, які Hermes ніколи не прикріпить, навіть якщо його про це попросить чужа сторінка.
// Прапорець i: диск macOS не розрізняє регістр, тож /.SSH/ — те саме, що /.ssh/.
const DENY = [
  /\/\.ssh\//i,
  /\/\.gnupg\//i,
  /\/\.aws\//i,
  /\/\.config\/gh\//i,
  /\/\.cloudflared\//i,
  /\/\.docker\/config\.json$/i,
  /\/\.kube\//i,
  /\/\.(netrc|npmrc|pypirc|git-credentials)$/i,
  /\/\.env(\.|$)/i,
  /\/\.hermes\/(\.env|\.api_server_key|auth\.json|google_(client_secret|token)\.json|config\.yaml|pairing\/|platforms\/)/i,
  /\/\.codex\/(auth\.json|config\.toml)/i,
  /\/\.claude(\.json|\/\.credentials)/i,
  new RegExp(`^${escapeRe(resolve(DATA_DIR))}/(\\.session-secret|\\.vapid\\.json|\\.hermes-hook-token|chat\\.db)`, 'i'),
  new RegExp(`^${escapeRe(HERMES_HOME)}/(\\.env|\\.api_server_key|auth\\.json|google_(client_secret|token)\\.json|config\\.yaml|pairing/|platforms/)`, 'i'),
  /\/Library\/Keychains\//i,
  /\/Library\/Cookies\//i,
  /\/Library\/Containers\/com\.apple\.Safari\//i,
  /\/Library\/Application Support\/[^/]+(\/[^/]+)*\/(Cookies|Login Data|Web Data|key4\.db|logins\.json|cookies\.sqlite)(-journal)?$/i,
  /id_[a-z0-9]+(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keychain-db)$/i,
  /\/config\.yaml/i,
]

function usable(p: string): string | null {
  const asked = resolve(p.startsWith('~/') ? join(HOME, p.slice(2)) : p)
  let full: string
  try {
    // Справжній шлях: посилання /tmp/x.txt → ~/.ssh/id_ed25519 не обійде заборону.
    full = realpathSync(asked)
  } catch {
    return null
  }
  const denied = (f: string) => DENY.some((re) => re.test(f)) || f.toLowerCase().startsWith(resolve(UPLOAD_DIR).toLowerCase())
  if (denied(asked) || denied(full)) return null
  try {
    const st = statSync(full)
    return st.isFile() && st.size > 0 && st.size <= MAX_FILE ? full : null
  } catch {
    return null
  }
}

// MEDIA:/path, MEDIA: `/path with spaces`, MEDIA:"/path"
const TAG_RE = /MEDIA:\s*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g
// Рядок, що складається лише з абсолютного шляху (можливо в лапках, коді чи як посилання).
const LINE_RE = /^[ \t>*_-]*[`"'(<]?((?:~|\/)[^\n`"'<>()]*?\.[A-Za-z0-9]{1,5})[`"')>]?[ \t*_.]*$/gm

/** Шукає файли у відповіді. Повертає шляхи і текст без службових рядків. */
export function extractMedia(text: string): { paths: string[]; text: string } {
  const found: string[] = []
  const add = (p: string) => {
    const full = usable(p.trim().replace(/[.,;:]+$/, ''))
    if (full && !found.includes(full)) found.push(full)
    return Boolean(full)
  }
  let out = text.replace(TAG_RE, (all, a, b, c, d) => (add(a ?? b ?? c ?? d) ? '' : all))
  // Шлях окремим рядком прибираємо лише тоді, коли такий файл справді є і його відомо, як показати.
  out = out.replace(LINE_RE, (all, p: string) => (MIME[extname(p).toLowerCase()] && add(p) ? '' : all))
  out = out.replace(/\n{3,}/g, '\n\n').trim()
  return { paths: found, text: out }
}

/**
 * Файл для чату. Невеликий копіюємо (на APFS це миттєвий клон), щоб він жив, навіть якщо Hermes його прибере.
 * Великий лишаємо на місці й пам'ятаємо шлях: завантажується оригінал за тимчасовим посиланням.
 */
export function importFile(path: string): Attachment {
  const id = randomBytes(9).toString('base64url')
  const size = statSync(path).size
  if (size >= REF_FROM) {
    const name = basename(path)
    const a: Attachment = { id, name, mime: mimeOf(name), size, ref: true }
    insertUpload({ ...a, path })
    return a
  }
  const dir = join(UPLOAD_DIR, id)
  mkdirSync(dir, { recursive: true })
  const name = basename(path)
  const dest = join(dir, name)
  copyFileSync(path, dest, constants.COPYFILE_FICLONE)
  const a: Attachment = { id, name, mime: mimeOf(name), size: statSync(dest).size }
  insertUpload({ ...a, path: dest })
  return a
}

export function collectMedia(text: string): { attachments: Attachment[]; text: string } {
  if (!text || (!text.includes('MEDIA:') && !text.includes('/'))) return { attachments: [], text }
  const { paths, text: cleaned } = extractMedia(text)
  const attachments: Attachment[] = []
  for (const p of paths) {
    try {
      if (existsSync(p)) attachments.push(importFile(p))
    } catch (err) {
      console.warn(`[media] не вдалося скопіювати ${p}: ${(err as Error).message}`)
    }
  }
  return { attachments, text: attachments.length ? cleaned : text }
}

/**
 * Чистка сховища файлів. Файли видаленого чату прибираються одразу (minAge 0),
 * а завантажені, але не надіслані — через добу. Резервних копій немає навмисно.
 */
export function sweepUploads(minAgeMs = 24 * 3600_000, only?: Set<string>) {
  let freed = 0
  for (const u of orphanUploads(minAgeMs)) {
    if (only && !only.has(u.id)) continue
    const dir = dirname(u.path)
    // Лише наші теки data/uploads/<id>/, нічого поза сховищем.
    if (resolve(dir).startsWith(resolve(UPLOAD_DIR) + '/')) rmSync(dir, { recursive: true, force: true })
    deleteUploadRow(u.id)
    freed += u.size
  }
  if (freed) console.log(`[media] прибрано ${(freed / 1024 / 1024).toFixed(1)} МБ файлів без чату`)
}
