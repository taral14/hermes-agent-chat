// Що з файлів можна відкрити просто в чаті (решту — завантажити).
import { emit } from './bus.ts'

export type ViewKind = 'pdf' | 'image' | 'text'
export type ViewFile = { url: string; name: string; mime: string; size: number }

/** Текст більший за це показувати в браузері немає сенсу: краще завантажити. */
const TEXT_LIMIT = 5 * 1024 * 1024
const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|log|srt|vtt|xml|html?|css|js|ts|tsx|jsx|py|sh|rb|go|rs|swift|kt|sql|ini|conf)$/i

export function viewKind(name: string, mime: string, size: number): ViewKind | null {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if ((mime.startsWith('text/') || TEXT_EXT.test(name)) && size <= TEXT_LIMIT) return 'text'
  return null
}

/**
 * Відкрити файл у переглядачі застосунку. Якщо переглядача немає (обробник не підписаний) або натиснуто
 * Cmd/Ctrl/середню кнопку — нехай посилання працює як звичайне.
 */
export function openInViewer(e: React.MouseEvent, f: ViewFile): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !viewKind(f.name, f.mime, f.size)) return
  if (emit('file', f)) e.preventDefault()
}
