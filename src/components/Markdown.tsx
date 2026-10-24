import { BookOpen, Check, Copy, ImageOff } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type Options, defaultUrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { emit } from '../bus.ts'
import { linkifyNotes, notePath, useNoteIndex } from '../kb.ts'
import { shortUrl } from '../links.ts'

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
            if (emit('kbnote', path)) e.preventDefault()
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
            if (emit('obsidian', href)) e.preventDefault()
          }}
        >
          <BookOpen size={15} />
          <span>{label}</span>
        </a>
      )
    }
    // Голу адресу показуємо коротко, як у повідомленнях користувача: без https://www.
    const bare = href && /^https?:\/\//.test(href) && textOf(children) === href
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" title={bare ? href : undefined}>
        {bare ? shortUrl(href) : children}
      </a>
    )
  },
  img({ src, alt }) {
    return typeof src === 'string' && src ? <MdImage src={src} alt={alt ?? ''} /> : null
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    )
  },
}

/**
 * Картинка з Markdown. Свої файли показуємо одразу, а чужі адреси — лише після кліку: браузер сам ходить
 * за картинкою, тож підкинута Hermes сторінка (prompt injection) могла б винести дані в адресі картинки.
 */
function MdImage({ src, alt }: { src: string; alt: string }) {
  const own = src.startsWith('/') && !src.startsWith('//')
  const [shown, setShown] = useState(own || src.startsWith('data:image/'))
  if (shown) return <img src={src} alt={alt} loading="lazy" />
  let host = src
  try {
    host = new URL(src).host
  } catch {
    /* лишаємо як є */
  }
  return (
    <button type="button" className="md-image-gate" onClick={() => setShown(true)} title={src}>
      <ImageOff size={16} />
      <span>
        Картинка з <b>{host}</b>
        {alt ? ` · ${alt}` : ''} — показати
      </span>
    </button>
  )
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

const REMARK = [remarkGfm]
const REHYPE: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false, ignoreMissing: true }]]
const urlTransform = (url: string) => (url.startsWith('obsidian://') || url.startsWith('kbnote:') ? url : defaultUrlTransform(url))

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const mentions = /\.md\b|\[\[/.test(text)
  const notes = useNoteIndex(mentions)
  const source = useMemo(() => linkifyNotes(linkifyObsidian(text), mentions ? notes : null), [text, mentions, notes])
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
})
