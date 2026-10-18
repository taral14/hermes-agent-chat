// База знань: Obsidian-сховище, куди пише Hermes. Читаємо нотатки, розв'язуємо [[вікі-посилання]],
// рахуємо зворотні посилання і стежимо за змінами, щоб показувати нове наживо.
import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Шлях до сховища: VAULT_PATH, інакше OBSIDIAN_VAULT_PATH із налаштувань Hermes, інакше типове iCloud-сховище. */
function vaultPath(): string {
  if (process.env.VAULT_PATH) return process.env.VAULT_PATH
  try {
    const env = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8')
    const m = env.match(/^OBSIDIAN_VAULT_PATH=["']?([^"'\n]+)/m)
    if (m) return m[1]!.replace(/^~/, homedir())
  } catch {
    /* немає .env */
  }
  return join(homedir(), 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'Hermes Vault')
}

export const VAULT = resolve(vaultPath())
const SKIP = new Set(['.obsidian', '.trash', '.git', 'node_modules'])
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.mp3', '.m4a', '.wav', '.mp4', '.txt', '.json', '.csv', '.tsv', '.xml'])

export type NoteMeta = {
  path: string // відносний шлях з .md
  title: string
  folder: string
  mtime: number
  size: number
  tags: string[]
}

type Note = NoteMeta & {
  body: string
  frontmatter: Record<string, unknown> | null
  links: string[] // сирі цілі [[...]] без псевдоніма й заголовка
}

const notes = new Map<string, Note>()
const assets = new Map<string, { path: string; mtime: number; size: number }>()
let lastScan = 0

// ---------- Розбір ----------

const WIKILINK = /(!?)\[\[([^\]|#^]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g

function splitFrontmatter(text: string): { fm: Record<string, unknown> | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { fm: null, body: text }
  try {
    const fm = parseYaml(m[1]!) as unknown
    return { fm: fm && typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>) : null, body: text.slice(m[0].length) }
  } catch {
    return { fm: null, body: text }
  }
}

function tagsOf(fm: Record<string, unknown> | null, body: string): string[] {
  const out = new Set<string>()
  const raw = fm?.tags ?? fm?.tag
  for (const t of Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []) {
    const s = String(t).replace(/^#/, '').trim()
    if (s) out.add(s)
  }
  for (const m of body.matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gu)) out.add(m[1]!)
  return [...out]
}

function load(rel: string, full: string, st: { mtimeMs: number; size: number }): Note {
  const text = readFileSync(full, 'utf8')
  const { fm, body } = splitFrontmatter(text)
  const links: string[] = []
  for (const m of body.matchAll(WIKILINK)) links.push(m[2]!.trim())
  const title = typeof fm?.title === 'string' && fm.title.trim() ? fm.title.trim() : basename(rel, '.md')
  return {
    path: rel,
    title,
    folder: dirname(rel) === '.' ? '' : dirname(rel),
    mtime: st.mtimeMs,
    size: st.size,
    tags: tagsOf(fm, body),
    body,
    frontmatter: fm,
    links,
  }
}

/** Пересканувати сховище. Перечитуються лише змінені файли, тож це дешево. */
function scan() {
  if (!existsSync(VAULT)) return
  const seen = new Set<string>()
  const seenAssets = new Set<string>()
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && SKIP.has(e.name)) continue
      if (SKIP.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        const rel = relative(VAULT, full).split(sep).join('/')
        const ext = extname(e.name).toLowerCase()
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (ext === '.md') {
          seen.add(rel)
          const prev = notes.get(rel)
          if (!prev || prev.mtime !== st.mtimeMs || prev.size !== st.size) {
            try {
              notes.set(rel, load(rel, full, st))
            } catch {
              /* файл ще не докачався з iCloud */
            }
          }
        } else if (ASSET_EXT.has(ext)) {
          seenAssets.add(rel)
          assets.set(rel, { path: rel, mtime: st.mtimeMs, size: st.size })
        }
      }
    }
  }
  walk(VAULT)
  for (const k of notes.keys()) if (!seen.has(k)) notes.delete(k)
  for (const k of assets.keys()) if (!seenAssets.has(k)) assets.delete(k)
  lastScan = Date.now()
}

function fresh() {
  if (Date.now() - lastScan > 5000) scan()
}

// ---------- Посилання ----------

/** Як Obsidian: [[Назва]] — нотатка з такою назвою файлу (найкоротший шлях), [[папка/Назва]] — точний шлях. */
export function resolveLink(target: string): string | null {
  const t = target.trim().replace(/\.md$/i, '')
  if (!t) return null
  const lower = t.toLowerCase()
  if (notes.has(`${t}.md`)) return `${t}.md`
  let best: string | null = null
  for (const p of notes.keys()) {
    const noExt = p.slice(0, -3).toLowerCase()
    if (noExt === lower || noExt.endsWith(`/${lower}`) || basename(noExt) === lower) {
      if (!best || p.length < best.length) best = p
    }
  }
  if (best) return best
  // Вкладення: ![[картинка.png]]
  for (const a of assets.keys()) if (a.toLowerCase() === lower || a.toLowerCase().endsWith(`/${lower}`)) return a
  return null
}

function backlinks(path: string) {
  const out: { path: string; title: string; folder: string; snippet: string }[] = []
  for (const n of notes.values()) {
    if (n.path === path) continue
    if (!n.links.some((l) => resolveLink(l) === path)) continue
    // Фрагмент тексту навколо першого посилання.
    let snippet = ''
    for (const m of n.body.matchAll(WIKILINK)) {
      if (resolveLink(m[2]!) !== path) continue
      const i = m.index ?? 0
      snippet = n.body
        .slice(Math.max(0, i - 90), i + m[0].length + 90)
        .replace(/\s+/g, ' ')
        .trim()
      break
    }
    out.push({ path: n.path, title: n.title, folder: n.folder, snippet })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'uk'))
}

// ---------- Публічне API ----------

const meta = ({ path, title, folder, mtime, size, tags }: Note): NoteMeta => ({ path, title, folder, mtime, size, tags })

export function vaultInfo() {
  fresh()
  return { available: existsSync(VAULT), name: basename(VAULT), notes: notes.size }
}

export function listNotes(): NoteMeta[] {
  fresh()
  return [...notes.values()].map(meta).sort((a, b) => a.path.localeCompare(b.path, 'uk'))
}

export function getNote(path: string) {
  fresh()
  const n = notes.get(path)
  if (!n) return null
  const resolved: Record<string, string | null> = {}
  for (const l of n.links) resolved[l] = resolveLink(l)
  return { ...meta(n), body: n.body, frontmatter: n.frontmatter, links: resolved, backlinks: backlinks(path) }
}

export function searchNotes(q: string) {
  fresh()
  const query = q.trim().toLowerCase()
  if (!query) return []
  const words = query.split(/\s+/).filter(Boolean)
  const results: (NoteMeta & { score: number; snippet: string })[] = []
  for (const n of notes.values()) {
    const title = n.title.toLowerCase()
    const body = n.body.toLowerCase()
    if (!words.every((w) => title.includes(w) || body.includes(w) || n.path.toLowerCase().includes(w))) continue
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 10
      score += Math.min(5, body.split(w).length - 1)
    }
    const i = body.indexOf(words[0]!)
    const snippet = i >= 0 ? n.body.slice(Math.max(0, i - 70), i + 140).replace(/\s+/g, ' ').trim() : n.body.slice(0, 160).replace(/\s+/g, ' ')
    results.push({ ...meta(n), score, snippet })
  }
  return results.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, 50)
}

export function graph() {
  fresh()
  const nodes = [...notes.values()].map((n) => ({ id: n.path, title: n.title, folder: n.folder.split('/')[0] ?? '' }))
  const edges: [string, string][] = []
  const seen = new Set<string>()
  for (const n of notes.values()) {
    for (const l of n.links) {
      const to = resolveLink(l)
      if (!to || to === n.path || !notes.has(to)) continue
      const key = n.path < to ? `${n.path}\u0000${to}` : `${to}\u0000${n.path}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([n.path, to])
    }
  }
  return { nodes, edges }
}

/** Безпечний повний шлях до файлу сховища (вкладення для ![[...]]). */
export function vaultFile(rel: string): string | null {
  const full = resolve(VAULT, rel)
  if (!full.startsWith(VAULT + sep) || !existsSync(full)) return null
  if (rel.split('/').some((seg) => SKIP.has(seg))) return null
  return full
}

/** Стежимо за сховищем: Hermes щось записав — оновлюємо індекс і кажемо вкладкам. */
export function watchVault(onChange: (paths: string[]) => void) {
  if (!existsSync(VAULT)) return
  scan()
  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  try {
    watch(VAULT, { recursive: true }, (_event, file) => {
      if (!file) return
      const rel = String(file).split(sep).join('/')
      if (rel.split('/').some((seg) => SKIP.has(seg))) return
      pending.add(rel)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const changed = [...pending].filter((p) => p.endsWith('.md'))
        pending = new Set()
        lastScan = 0
        scan()
        if (changed.length) onChange(changed)
      }, 700)
    })
  } catch (err) {
    console.warn(`[vault] не вдалося стежити за сховищем: ${(err as Error).message}`)
  }
}
