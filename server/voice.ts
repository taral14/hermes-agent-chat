// Голос: розпізнавання записів із поля вводу й озвучка відповідей засобами Hermes (див. voice.py).
// Обробник — один довгоживучий процес у середовищі Hermes: модель Whisper лишається завантаженою між
// записами, а після 10 хвилин тиші процес завершується й звільняє пам'ять.
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { DATA_DIR } from './db.ts'
import { HttpError } from './http.ts'
import { hermesEnv, hermesScript } from './runtime.ts'
import { newId } from './util.ts'

const SCRIPT = join(import.meta.dirname, 'voice.py')
const TMP = join(DATA_DIR, 'tmp')
const SPEECH = join(DATA_DIR, 'speech')
const IDLE = 10 * 60_000
/** Скільки тримати озвучені відповіді. */
const SPEECH_TTL = 14 * 24 * 3600_000
export const MAX_RECORDING = 25 * 1024 * 1024
export const MAX_SPEECH_CHARS = 20_000

type Reply = { id: number; text?: string; files?: string[]; error?: string }
type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void }

let child: ChildProcessWithoutNullStreams | null = null
let seq = 0
const pending = new Map<number, Pending>()
let idleTimer: NodeJS.Timeout | null = null

async function worker(): Promise<ChildProcessWithoutNullStreams> {
  if (child) return child
  const [cmd, ...args] = await hermesScript(SCRIPT)
  if (child) return child
  const c = spawn(cmd!, args, { env: hermesEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  c.stderr.resume()
  createInterface({ input: c.stdout }).on('line', (line) => {
    let r: Reply
    try {
      r = JSON.parse(line) as Reply
    } catch {
      return
    }
    const p = pending.get(r.id)
    if (!p) return
    pending.delete(r.id)
    p.resolve(r)
  })
  const gone = (why: string) => {
    if (child !== c) return
    child = null
    for (const p of pending.values()) p.reject(new Error(why))
    pending.clear()
  }
  c.on('exit', () => gone('обробник голосу завершився'))
  c.on('error', (e) => gone(e.message))
  child = c
  return c
}

async function call(req: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
  const c = await worker()
  if (idleTimer) clearTimeout(idleTimer)
  const id = ++seq
  try {
    return await new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Hermes не відповів вчасно'))
      }, timeoutMs)
      pending.set(id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      c.stdin.write(`${JSON.stringify({ id, ...req })}\n`)
    })
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!pending.size) child?.stdin.end()
    }, IDLE)
  }
}

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/** Запис із мікрофона → текст. */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const ext = EXT[mime.split(';')[0]!.trim().toLowerCase()]
  if (!ext) throw new HttpError(415, 'Такий формат запису не підтримується')
  if (!audio.length) throw new HttpError(400, 'Порожній запис')
  await mkdir(TMP, { recursive: true })
  const file = join(TMP, `voice-${newId()}.${ext}`)
  await writeFile(file, audio)
  try {
    const r = await call({ op: 'stt', path: file }, 180_000)
    if (r.error) throw new HttpError(502, `Не вдалося розпізнати: ${r.error}`)
    return r.text ?? ''
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, `Не вдалося розпізнати: ${(err as Error).message}`)
  } finally {
    await rm(file, { force: true })
  }
}

/** Текст помилки без ключів API (провайдер може повернути їх частково). */
const clean = (e: string) => e.replace(/\b(sk|key|token)[-_][\w*.-]{6,}/gi, '$1-…').slice(0, 200)

/** Markdown → текст для читання вголос: без розмітки, коду й адрес. */
export function spokenText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, '')
    .replace(/[*_~|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Голос macOS за мовою тексту: українська, російська чи англійська. */
function macVoice(text: string): string {
  const uk = (text.match(/[іїєґІЇЄҐ]/g) ?? []).length
  const ru = (text.match(/[ыэъёЫЭЪЁ]/g) ?? []).length
  const cyr = (text.match(/[а-яА-Я]/g) ?? []).length
  const lat = (text.match(/[a-zA-Z]/g) ?? []).length
  if (lat > cyr) return 'Samantha'
  return ru > uk ? 'Milena' : 'Lesya'
}

/** Запасна озвучка голосом macOS (say), якщо озвучка Hermes не працює: локально й без ключів. */
async function saySpeech(text: string, out: string): Promise<string> {
  const input = `${out}.txt`
  await writeFile(input, spokenText(text))
  try {
    await promisify(execFile)('say', ['-v', macVoice(text), '-f', input, '-o', out, '--file-format=m4af', '--data-format=aac'], { timeout: 300_000 })
  } finally {
    await rm(input, { force: true })
  }
  return out
}

/** Озвучка Hermes нещодавно не вдалась: якийсь час одразу беремо запасну. */
let hermesTtsFailedAt = 0

const MIME: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }
const inflight = new Map<string, Promise<string>>()

/** Озвучка тексту відповіді: файл у кеші (за повідомленням і текстом) або щойно створений. */
export async function speech(messageId: string, text: string): Promise<{ path: string; mime: string }> {
  if (!text.trim()) throw new HttpError(400, 'Немає тексту для озвучки')
  if (text.length > MAX_SPEECH_CHARS) throw new HttpError(413, 'Відповідь задовга для озвучки')
  const key = `${messageId}-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`
  let job = inflight.get(key)
  if (!job) {
    job = (async () => {
      await mkdir(SPEECH, { recursive: true })
      const ready = (await readdir(SPEECH)).find((f) => f.startsWith(`${key}.`))
      if (ready) return join(SPEECH, ready)
      const mac = process.platform === 'darwin'
      if (!mac || Date.now() - hermesTtsFailedAt > 10 * 60_000) {
        let error: string
        try {
          const r = await call({ op: 'tts', text, out: join(SPEECH, `${key}.mp3`) }, 300_000)
          if (!r.error && r.files?.length) return r.files[0]!
          error = r.error ?? 'порожній результат'
        } catch (err) {
          error = (err as Error).message
        }
        if (!mac) throw new HttpError(502, `Не вдалося озвучити: ${clean(error)}`)
        hermesTtsFailedAt = Date.now()
        console.warn(`voice: озвучка Hermes не вдалась (${clean(error)}), читаю голосом macOS`)
      }
      return saySpeech(text, join(SPEECH, `${key}.m4a`))
    })().finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  let path: string
  try {
    path = await job
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, `Не вдалося озвучити: ${(err as Error).message}`)
  }
  if (!existsSync(path)) throw new HttpError(502, 'Озвучка не збереглась')
  return { path, mime: MIME[path.split('.').pop()!.toLowerCase()] ?? 'audio/mpeg' }
}

/** Прибрати старі озвучки (раз на добу з index.ts). */
export async function sweepSpeech() {
  let files: string[]
  try {
    files = await readdir(SPEECH)
  } catch {
    return
  }
  const old = Date.now() - SPEECH_TTL
  for (const f of files) {
    const p = join(SPEECH, f)
    try {
      if (statSync(p).mtimeMs < old) await rm(p, { force: true })
    } catch {
      /* уже немає */
    }
  }
}

export function stopVoice() {
  if (idleTimer) clearTimeout(idleTimer)
  child?.kill()
  child = null
}
