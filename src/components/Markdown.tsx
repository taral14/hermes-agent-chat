import { Check, Copy } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

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

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
