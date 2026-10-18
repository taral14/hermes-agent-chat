// Файли, які Hermes надсилає в чат: тег MEDIA:<шлях> (як у Telegram) або окремий рядок із шляхом до файлу.
import { randomBytes } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { Attachment } from '../src/shared.ts'
import { UPLOAD_DIR, insertUpload } from './db.ts'

const MAX_FILE = 500 * 1024 * 1024

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
}

export const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'

/** Те, що Hermes каже про файли в чаті. Додається до системного промпта кожного запуску. */
export const CHAT_INSTRUCTIONS = [
  'You are talking to the user through their private web chat (chat.example.com), which renders Markdown.',
  'To deliver a file to the user (audio you synthesized, an image, video, PDF, document, archive, anything),',
  'put a line `MEDIA:/absolute/path/to/file` in your final answer, one line per file. The chat attaches the file',
  'to your message: audio and video get a player, images a preview, other files a download card.',
  'Do not paste the bare path or file contents instead, and do not explain how to open the file.',
  'Files the user attaches are saved on this Mac and listed with absolute paths in their message.',
].join(' ')

const HOME = homedir()
/** Секрети не віддаємо, навіть якщо модель про них згадала. */
const DENY = [/\/\.ssh\//, /\/\.gnupg\//, /\/\.hermes\/\.env$/, /\/\.env(\.|$)/, /\/Library\/Keychains\//, /\/\.aws\//, /\/\.config\/gh\//, /id_[a-z0-9]+$/, /\.pem$/, /\/config\.yaml$/]

function usable(p: string): string | null {
  const full = resolve(p.startsWith('~/') ? join(HOME, p.slice(2)) : p)
  if (DENY.some((re) => re.test(full)) || full.startsWith(resolve(UPLOAD_DIR))) return null
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

/** Копія файлу в сховище чату (на APFS це миттєвий клон), щоб він жив, навіть якщо Hermes його прибере. */
export function importFile(path: string): Attachment {
  const id = randomBytes(9).toString('base64url')
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
