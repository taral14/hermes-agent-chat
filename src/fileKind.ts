// Тип файлу за розширенням і MIME: іконка, колір і підпис для картки файлу.
import {
  BookOpen,
  Disc3,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Package,
  Presentation,
  Type,
  Database,
  type LucideIcon,
} from 'lucide-react'

export type FileKind = { label: string; color: string; Icon: LucideIcon }

const BY_EXT: [RegExp, FileKind][] = [
  [/^(zip|tar|gz|tgz|bz2|xz|7z|rar)$/, { label: 'Архів', color: '#8b5e34', Icon: FileArchive }],
  [/^(dmg|iso|img)$/, { label: 'Образ диска', color: '#64748b', Icon: Disc3 }],
  [/^(pkg|apk|ipa|app|exe|msi|deb)$/, { label: 'Застосунок', color: '#0f766e', Icon: Package }],
  [/^(mp4|m4v|mov|mkv|avi|webm|wmv|flv)$/, { label: 'Відео', color: '#e54666', Icon: FileVideo }],
  [/^(mp3|m4a|aac|wav|ogg|oga|opus|flac|aiff)$/, { label: 'Аудіо', color: '#8e4ec6', Icon: FileAudio }],
  [/^(png|jpe?g|gif|webp|svg|heic|tiff?|bmp)$/, { label: 'Зображення', color: '#0ea5e9', Icon: FileImage }],
  [/^pdf$/, { label: 'PDF', color: '#e5484d', Icon: FileText }],
  [/^(xlsx?|csv|tsv|numbers|ods)$/, { label: 'Таблиця', color: '#10a37f', Icon: FileSpreadsheet }],
  [/^(pptx?|key|odp)$/, { label: 'Презентація', color: '#f97316', Icon: Presentation }],
  [/^(docx?|pages|odt|rtf|txt|md)$/, { label: 'Документ', color: '#0285ff', Icon: FileText }],
  [/^(epub|mobi|fb2)$/, { label: 'Книга', color: '#b45309', Icon: BookOpen }],
  [/^(ttf|otf|woff2?)$/, { label: 'Шрифт', color: '#475569', Icon: Type }],
  [/^(sqlite|db|gguf|safetensors|bin)$/, { label: 'Дані', color: '#6366f1', Icon: Database }],
  [/^(js|ts|tsx|jsx|py|sh|rb|go|rs|java|c|cpp|h|swift|kt|json|ya?ml|toml|html|css|xml|srt|vtt|log)$/, { label: 'Код', color: '#334155', Icon: FileCode2 }],
]

export function fileKind(name: string, mime = ''): FileKind & { ext: string } {
  const ext = (name.includes('.') ? name.split('.').pop()! : '').toLowerCase()
  for (const [re, k] of BY_EXT) if (re.test(ext)) return { ...k, ext }
  if (mime.startsWith('video/')) return { label: 'Відео', color: '#e54666', Icon: FileVideo, ext }
  if (mime.startsWith('audio/')) return { label: 'Аудіо', color: '#8e4ec6', Icon: FileAudio, ext }
  if (mime.startsWith('image/')) return { label: 'Зображення', color: '#0ea5e9', Icon: FileImage, ext }
  return { label: 'Файл', color: '#6f6f6f', Icon: FileIcon, ext }
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} МБ`
  return `${(n / 1024 / 1024 / 1024).toFixed(n < 10 * 1024 ** 3 ? 2 : 1)} ГБ`
}
