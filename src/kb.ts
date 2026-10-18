// База знань на клієнті: запити й перетворення Obsidian-розмітки в звичайний Markdown.
import { useEffect, useSyncExternalStore } from 'react'
import type { KbNote, KbNoteFull } from './shared.ts'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Помилка ${res.status}`)
  return data
}

export const kb = {
  index: () => get<{ available: boolean; name: string; notes: number; list: KbNote[] }>('/api/kb'),
  note: (path: string) => get<KbNoteFull>(`/api/kb/note?path=${encodeURIComponent(path)}`),
  search: (q: string) => get<(KbNote & { snippet: string })[]>(`/api/kb/search?q=${encodeURIComponent(q)}`),
  graph: () => get<{ nodes: { id: string; title: string; folder: string }[]; edges: [string, string][] }>('/api/kb/graph'),
  resolve: (target: string) => get<{ path: string | null }>(`/api/kb/resolve?target=${encodeURIComponent(target)}`),
}

export const kbFileUrl = (path: string) => `/api/kb/file?path=${encodeURIComponent(path)}`
export const notePath = (path: string) => `/kb/n/${path.split('/').map(encodeURIComponent).join('/')}`

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
const CALLOUT: Record<string, string> = {
  note: 'Примітка', info: 'Інфо', tip: 'Порада', hint: 'Порада', important: 'Важливо', warning: 'Увага', caution: 'Обережно',
  danger: 'Небезпека', error: 'Помилка', bug: 'Помилка', example: 'Приклад', quote: 'Цитата', abstract: 'Коротко',
  summary: 'Коротко', todo: 'Зробити', success: 'Готово', question: 'Питання', faq: 'Питання', failure: 'Не вдалося',
}

/**
 * Obsidian → Markdown: [[ціль|текст]] стає посиланням `kb:`, ![[картинка]] — зображенням,
 * > [!note] Заголовок — цитатою з жирним заголовком. Код у ``` не чіпаємо.
 */
export function obsidianToMarkdown(body: string, links: Record<string, string | null>): string {
  const parts = body.split(/(```[\s\S]*?```)/g)
  return parts
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk
      return chunk
        .replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_all, target: string, alias?: string) => {
          const path = links[target.trim()]
          if (path && IMAGE.test(path)) return `![${alias ?? target}](${kbFileUrl(path)})`
          return `[↪ ${alias ?? target.trim()}](kb:${encodeURIComponent(target.trim())})`
        })
        .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_all, target: string, heading?: string, alias?: string) => {
          const text = (alias ?? `${target.trim()}${heading ? ` › ${heading.slice(1)}` : ''}`).replace(/[[\]]/g, '')
          return `[${text}](kb:${encodeURIComponent(target.trim())})`
        })
        .replace(/^(>\s*)\[!(\w+)\][+-]?\s*(.*)$/gm, (_all, q: string, type: string, title: string) => {
          const label = title.trim() || CALLOUT[type.toLowerCase()] || type
          return `${q}**${label}**`
        })
        .replace(/==([^=\n]+)==/g, '**$1**')
    })
    .join('')
}

/** Текст фрагмента без розмітки посилань (для зворотних посилань і пошуку). */
export const plainSnippet = (s: string) =>
  s.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_a, t: string, al?: string) => al ?? t).replace(/[*_`#>]+/g, '')

/** obsidian://open?vault=…&file=Hermes%20Vault%2F… → шлях нотатки у сховищі (або null). */
export function obsidianUriToPath(href: string, vaultName: string): string | null {
  if (!href.startsWith('obsidian://')) return null
  try {
    const u = new URL(href)
    const file = u.searchParams.get('file') ?? u.searchParams.get('path')
    if (!file) return null
    let rel = file.replace(/^\/+/, '')
    if (rel.startsWith(`${vaultName}/`)) rel = rel.slice(vaultName.length + 1)
    return rel.endsWith('.md') ? rel : `${rel}.md`
  } catch {
    return null
  }
}

// ---------- Згадки нотаток у відповідях Hermes ----------
// Hermes пише «Створено: Gaming/Назва.md» чи [[Назва]]. Якщо така нотатка є в базі знань, згадка стає
// карткою нотатки, що відкриває її в чаті. Індекс нотаток вантажимо лише коли в тексті є щось схоже.

let index: KbNote[] | null = null
/** Назва сховища (тека, на яку вказує OBSIDIAN_VAULT_PATH у Hermes) — з сервера, не з коду. */
let vaultName = ''
let loadedAt = 0
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function loadNoteIndex(maxAgeMs = 60_000) {
  if (loading || (index && Date.now() - loadedAt < maxAgeMs)) return
  loading = kb
    .index()
    .then((r) => {
      index = r.available ? r.list : []
      vaultName = r.name || ''
    })
    .catch(() => {
      index = index ?? [] // немає доступу (сторінка спільного чату) — просто без карток
    })
    .finally(() => {
      loadedAt = Date.now()
      loading = null
      for (const l of listeners) l()
    })
}

/** Hermes змінив нотатки (подія kb): наступне звернення перечитає індекс. */
export function invalidateNoteIndex() {
  loadedAt = 0
  if (index) loadNoteIndex()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useNoteIndex(wanted: boolean): KbNote[] | null {
  const notes = useSyncExternalStore(subscribe, () => index)
  useEffect(() => {
    if (wanted) loadNoteIndex()
  }, [wanted])
  return notes
}

/** Нотатка за згадкою: шлях від кореня сховища (з .md чи без), з назвою сховища попереду чи без, або назва. */
export function findNote(notes: KbNote[], raw: string, vault = vaultName): KbNote | null {
  let t = raw.trim().replace(/^\/+/, '')
  const at = vault ? t.indexOf(`${vault}/`) : -1
  if (at >= 0) t = t.slice(at + vault.length + 1)
  const lower = t.toLowerCase()
  const withMd = lower.endsWith('.md') ? lower : `${lower}.md`
  const exact = notes.find((n) => n.path.toLowerCase() === withMd)
  if (exact) return exact
  if (lower.includes('/')) return notes.find((n) => n.path.toLowerCase().endsWith(`/${withMd}`)) ?? null
  // Лише назва (як у [[вікі-посиланні]]): беремо, якщо вона однозначна.
  const byName = notes.filter((n) => n.path.toLowerCase().split('/').pop() === withMd || n.title.toLowerCase() === lower)
  return byName.length === 1 ? byName[0]! : null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const noteLink = (n: KbNote, text?: string) => `[${(text || n.title).replace(/[[\]]/g, '')}](kbnote:${encodeURIComponent(n.path)})`

/** Згадки нотаток у тексті відповіді → посилання kbnote:. Код у ``` і наявні посилання не чіпаємо. */
export function linkifyNotes(text: string, notes: KbNote[] | null, vault = vaultName): string {
  if (!notes?.length || !/\.md\b|\[\[/.test(text)) return text
  // Повні шляхи нотаток, довші першими, щоб «A/B.md» не з'їв частину «A/B.md.bak».
  const paths = notes.map((n) => n.path).filter((p) => p.includes('/') || p.length > 6).sort((a, b) => b.length - a.length)
  const byPath = new Map(notes.map((n) => [n.path, n]))
  // Перед шляхом може стояти повний шлях до сховища (з пробілами, як «Mobile Documents» в iCloud).
  const v = vault ? escapeRe(vault) : ''
  const prefix = v ? `(?:(?:~|/Users/)[^\\n\`"'()]*?${v}/|${v}/)?` : ''
  const pathRe = paths.length ? new RegExp(`${prefix}(${paths.map(escapeRe).join('|')})`, 'g') : null
  return text
    .split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\))/g)
    .map((chunk, i) => {
      if (i % 2 === 1) {
        // Шлях у `коді` цілком — посилання; інший код і готові посилання лишаємо.
        if (chunk.startsWith('`') && !chunk.startsWith('```')) {
          const n = findNote(notes, chunk.slice(1, -1), vault)
          if (n && /\.md$|\//.test(chunk)) return noteLink(n)
        }
        return chunk
      }
      let out = chunk.replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (all, target: string, alias?: string) => {
        const n = findNote(notes, target, vault)
        return n ? noteLink(n, alias) : all
      })
      if (pathRe) out = out.replace(pathRe, (all, p: string) => (byPath.has(p) ? noteLink(byPath.get(p)!) : all))
      return out
    })
    .join('')
}
