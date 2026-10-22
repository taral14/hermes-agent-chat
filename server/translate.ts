// Переклад описів (каталоги Hermes англійською) допоміжною моделлю Hermes — тією, що пише назви сесій.
// translate.py запускається разовим процесом у середовищі самого Hermes: команду дає штатний
// `hermes --print-runtime-command`, ми лише підставляємо свій скрипт. Кожен текст перекладаємо один раз.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getTranslations, saveTranslation } from './db.ts'
import { HttpError } from './http.ts'
import { hermesEnv, hermesScript } from './runtime.ts'

const SCRIPT = join(import.meta.dirname, 'translate.py')
export const MAX_TEXTS = 20
export const MAX_LENGTH = 4000

async function runModel(texts: string[]): Promise<string[]> {
  const [cmd, ...args] = await hermesScript(SCRIPT)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, args, { env: hermesEnv(), stdio: ['pipe', 'pipe', 'ignore'], timeout: 120_000 })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', reject)
    child.on('close', () => {
      try {
        const r = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { translations?: string[]; error?: string }
        if (r.translations) resolve(r.translations)
        else reject(new Error(r.error ?? 'порожня відповідь'))
      } catch {
        reject(new Error('Hermes не відповів'))
      }
    })
    child.stdin.end(JSON.stringify({ texts, lang: 'Ukrainian' }))
  })
}

const keyOf = (text: string) => createHash('sha256').update(`uk\n${text}`).digest('hex')

/** Тексти без перекладу йдуть моделі одним запитом; решта — з кешу. */
export async function translate(texts: string[]): Promise<string[]> {
  if (texts.length > MAX_TEXTS || texts.some((t) => t.length > MAX_LENGTH)) throw new HttpError(400, 'Забагато тексту для перекладу')
  const keys = texts.map(keyOf)
  const cached = getTranslations(keys)
  const missing = [...new Set(texts.filter((_, i) => !cached.has(keys[i]!)))]
  if (missing.length) {
    let fresh: string[]
    try {
      fresh = await runModel(missing)
    } catch (err) {
      throw new HttpError(502, `Не вдалося перекласти: ${(err as Error).message}`)
    }
    missing.forEach((t, i) => {
      const k = keyOf(t)
      saveTranslation(k, fresh[i]!)
      cached.set(k, fresh[i]!)
    })
  }
  return keys.map((k) => cached.get(k)!)
}
