// База знань на клієнті: запити й перетворення Obsidian-розмітки в звичайний Markdown.
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
