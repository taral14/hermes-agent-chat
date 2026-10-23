// Дзеркало Obsidian-сховища Hermes (iCloud Drive) у chat/data/vault/<назва сховища>.
//
// Навіщо: сервер чату запускає роутер, і macOS не пускає цей процес в iCloud Drive. Ця служба
// стартує через osascript (як gateway Hermes), тому має доступ, і копіює нотатки туди, де їх читає чат.
// Копія лише в один бік: з iCloud у чат. Видалені в сховищі файли зникають і з копії.
//
// Запуск: launchd-агент із scripts/install-vault-mirror.sh (лише macOS). Сховище — VAULT_PATH із .env чату.
import { existsSync, watch } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

const HERE = dirname(new URL(import.meta.url).pathname)
const DATA = process.env.DATA_DIR ?? join(HERE, '..', 'data')

if (!process.env.VAULT_PATH?.trim()) {
  console.error('VAULT_PATH не задано в .env чату: дзеркалити нічого')
  process.exit(1)
}
const SRC = resolve(process.env.VAULT_PATH.trim().replace(/^~(?=$|\/)/, homedir()))
const DEST = join(DATA, 'vault', basename(SRC))
const SKIP = new Set(['.obsidian', '.trash', '.git', 'node_modules'])
const EXT = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.mp3', '.m4a', '.wav', '.mp4', '.txt', '.json', '.csv', '.tsv', '.xml'])

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`)

async function list(root) {
  const out = new Map()
  const walk = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile() && EXT.has(extname(e.name).toLowerCase())) {
        try {
          const st = await stat(full)
          out.set(relative(root, full).split(sep).join('/'), { mtime: st.mtimeMs, size: st.size })
        } catch {
          /* файл зник між readdir і stat */
        }
      }
    }
  }
  await walk(root)
  return out
}

let running = null
let again = false

/** Звірити копію з джерелом: скопіювати нові й змінені файли, прибрати видалені. */
async function sync(reason) {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    const [src, dst] = await Promise.all([list(SRC), list(DEST)])
    if (src.size === 0 && dst.size > 0) {
      // Порожнє джерело — найімовірніше, iCloud ще не підтягнувся. Копію не чіпаємо.
      log(`джерело порожнє, пропускаю (${reason})`)
      return
    }
    let copied = 0
    let removed = 0
    for (const [rel, s] of src) {
      const d = dst.get(rel)
      if (d && d.size === s.size && Math.abs(d.mtime - s.mtime) < 1000) continue
      const from = join(SRC, rel)
      const to = join(DEST, rel)
      try {
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
        const t = new Date(s.mtime)
        await utimes(to, t, t)
        copied++
      } catch (err) {
        log(`не вдалося скопіювати ${rel}: ${err.message}`)
      }
    }
    for (const rel of dst.keys()) {
      if (src.has(rel)) continue
      await rm(join(DEST, rel), { force: true })
      removed++
    }
    await writeFile(join(DATA, 'vault', '.mirror.json'), JSON.stringify({ source: SRC, at: Date.now(), files: src.size }))
    if (copied || removed) log(`${reason}: скопійовано ${copied}, прибрано ${removed}, усього ${src.size}`)
  })()
    .catch((err) => log(`помилка синхронізації: ${err.message}`))
    .finally(() => {
      running = null
      if (again) {
        again = false
        void sync('повтор')
      }
    })
  return running
}

if (!existsSync(SRC)) log(`сховище не знайдено: ${SRC}`)
log(`дзеркало: ${SRC} → ${DEST}`)
await mkdir(DEST, { recursive: true })
await sync('старт')

let timer = null
try {
  watch(SRC, { recursive: true }, (_e, file) => {
    if (!file || String(file).split(sep).some((s) => SKIP.has(s))) return
    clearTimeout(timer)
    timer = setTimeout(() => void sync('зміна'), 500)
  })
} catch (err) {
  log(`стеження недоступне (${err.message}), лишається повна звірка щохвилини`)
}
setInterval(() => void sync('щохвилини'), 60_000)
