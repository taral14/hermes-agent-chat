import { BookOpen, Check, Copy } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { linkifyNotes, notePath, useNoteIndex } from '../kb.ts'

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

export function CopyButton({ text, label = 'Копіювати', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  )
}

const components: Components = {
  pre({ children }) {
    const code = Array.isArray(children) ? children[0] : children
    const cls = (code as { props?: { className?: string } } | undefined)?.props?.className ?? ''
    const lang = /language-([\w+-]+)/.exec(cls)?.[1] ?? ''
    return (
      <div className="code-block">
        <div className="code-head">
          <span>{lang || 'код'}</span>
          <CopyButton text={textOf(children).replace(/\n$/, '')} label="Копіювати код" />
        </div>
        <pre>{children}</pre>
      </div>
    )
  },
  a({ href, children }) {
    // Нотатка з бази знань, згадана у відповіді (див. linkifyNotes).
    if (href?.startsWith('kbnote:')) {
      const path = decodeURIComponent(href.slice('kbnote:'.length))
      return (
        <a
          href={notePath(path)}
          className="note-chip"
          title={path}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return
            e.preventDefault()
            window.dispatchEvent(new CustomEvent('chat:kbnote', { detail: path }))
          }}
        >
          <BookOpen size={15} />
          <span>{children}</span>
        </a>
      )
    }
    // Посилання Hermes на нотатки Obsidian відкриваються в базі знань чату.
    if (href?.startsWith('obsidian://')) {
      // Текст посилання — сама адреса? Показуємо назву нотатки.
      const text = textOf(children)
      const label = !text || text.startsWith('obsidian://') ? obsidianTitle(href) : children
      return (
        <a
          href={href}
          className="note-chip"
          onClick={(e) => {
            e.preventDefault()
            window.dispatchEvent(new CustomEvent('chat:obsidian', { detail: href }))
          }}
        >
          <BookOpen size={15} />
          <span>{label}</span>
        </a>
      )
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    )
  },
}

/** Назва нотатки з obsidian://open?...&file=Сховище%2FПапка%2FНазва → «Назва». */
function obsidianTitle(href: string): string {
  try {
    const file = new URL(href).searchParams.get('file') ?? ''
    return file.split('/').pop()?.replace(/\.md$/i, '') || 'Нотатка'
  } catch {
    return 'Нотатка'
  }
}

/**
 * Hermes часто пише obsidian://… голим текстом, а Markdown автоматично робить посиланнями лише http(s).
 * Обгортаємо такі адреси в посилання (окрім коду), щоб вони відкривались у базі знань.
 */
function linkifyObsidian(text: string): string {
  if (!text.includes('obsidian://')) return text
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(/(^|[^(<\]"'])(obsidian:\/\/[^\s<>)\]"'`]+)/g, (_all, pre: string, url: string) => {
            const clean = url.replace(/[.,;:!?]+$/, '')
            const tail = url.slice(clean.length)
            return `${pre}[${obsidianTitle(clean).replace(/[[\]]/g, '')}](${clean})${tail}`
          }),
    )
    .join('')
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const mentions = /\.md\b|\[\[/.test(text)
  const notes = useNoteIndex(mentions)
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
        urlTransform={(url) => (url.startsWith('obsidian://') || url.startsWith('kbnote:') ? url : defaultUrlTransform(url))}
      >
        {linkifyNotes(linkifyObsidian(text), mentions ? notes : null)}
      </ReactMarkdown>
    </div>
  )
})
