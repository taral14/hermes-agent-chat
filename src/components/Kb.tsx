import { BookOpen, ChevronRight, FileText, Folder, FolderOpen, Loader2, MessageSquarePlus, Network, Search, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { kb, notePath, obsidianToMarkdown, plainSnippet } from '../kb.ts'
import { formatDate, relative } from '../schedule.ts'
import type { KbNote, KbNoteFull } from '../shared.ts'
import { TopBar } from './ui/TopBar.tsx'
import { KbGraph } from './KbGraph.tsx'
import { CopyButton } from './Markdown.tsx'

export type KbRoute = { kind: 'home' } | { kind: 'note'; path: string } | { kind: 'graph'; focus?: string }

type Props = {
  route: KbRoute
  go: (r: KbRoute) => void
  back: () => void
  sidebarOpen: boolean
  openSidebar: () => void
  /** Лічильник змін у сховищі (подія від сервера): перезавантажити поточний екран. */
  version: number
  discuss: (note: KbNoteFull) => void
}

const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)

// ---------- Нотатка ----------

const NoteMarkdown = memo(function NoteMarkdown({ note, open }: { note: KbNoteFull; open: (path: string) => void }) {
  const text = useMemo(() => obsidianToMarkdown(note.body, note.links), [note.body, note.links])
  const components: Components = useMemo(
    () => ({
      a({ href, children }) {
        if (href?.startsWith('kb:')) {
          const target = decodeURIComponent(href.slice(3))
          const path = note.links[target]
          if (!path) return <span className="kb-unresolved" title="Такої нотатки ще немає">{children}</span>
          return (
            <a
              href={notePath(path)}
              className="kb-link"
              onClick={(e) => {
                e.preventDefault()
                open(path)
              }}
            >
              {children}
            </a>
          )
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        )
      },
      pre({ children }) {
        return (
          <div className="code-block">
            <div className="code-head">
              <span>код</span>
              <CopyButton text={String((children as { props?: { children?: unknown } })?.props?.children ?? '')} label="Копіювати код" />
            </div>
            <pre>{children}</pre>
          </div>
        )
      },
      table({ children }) {
        return (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        )
      },
    }),
    [note.links, open],
  )
  return (
    <div className="md kb-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
        urlTransform={(url) => (url.startsWith('kb:') ? url : defaultUrlTransform(url))}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function Properties({ fm }: { fm: Record<string, unknown> }) {
  const entries = Object.entries(fm).filter(([k]) => k !== 'title')
  if (!entries.length) return null
  const value = (v: unknown) => {
    if (Array.isArray(v))
      return (
        <span className="kb-chips">
          {v.map((x, i) => (
            <span key={i} className="kb-chip">
              {String(x)}
            </span>
          ))}
        </span>
      )
    if (v && typeof v === 'object') return <code>{JSON.stringify(v)}</code>
    return <span>{String(v)}</span>
  }
  return (
    <div className="kb-props">
      {entries.map(([k, v]) => (
        <div key={k} className="kb-prop">
          <span className="kb-prop-key">{k}</span>
          <span className="kb-prop-val">{value(v)}</span>
        </div>
      ))}
    </div>
  )
}

function NotePage({ path, go, back, sidebarOpen, openSidebar, version, discuss }: Props & { path: string }) {
  const [note, setNote] = useState<KbNoteFull | null>(null)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(false)
  const open = useCallback((p: string) => go({ kind: 'note', path: p }), [go])

  useEffect(() => {
    setNote(null)
    setError('')
  }, [path])

  useEffect(() => {
    let alive = true
    kb.note(path)
      .then((n) => {
        if (!alive) return
        setNote((prev) => {
          if (prev && prev.mtime !== n.mtime) {
            setUpdated(true)
            setTimeout(() => setUpdated(false), 2500)
          }
          return n
        })
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path, version])

  const crumbs = note?.folder ? note.folder.split('/') : []
  return (
    <>
      <TopBar
        title="База знань"
        back={back}
        sidebarOpen={sidebarOpen}
        openSidebar={openSidebar}
        right={
          <div className="kb-top-actions">
            <button type="button" className="icon-btn m-menu-btn" aria-label="Граф" title="Граф зв’язків" onClick={() => go({ kind: 'graph', focus: path })}>
              <Network size={19} />
            </button>
          </div>
        }
      />
      <div className="jobs-scroll">
        <article className="kb-note">
          {error && <div className="msg-error">{error}</div>}
          {!note && !error && (
            <div className="jobs-loading">
              <Loader2 size={22} className="spin" />
            </div>
          )}
          {note && (
            <>
              {crumbs.length > 0 && (
                <div className="kb-crumbs">
                  {crumbs.map((c, i) => (
                    <span key={i}>
                      {i > 0 && <ChevronRight size={13} />}
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <h1 className="kb-title">{note.title}</h1>
              <div className="kb-meta">
                Змінено {relative(note.mtime)} · {size(note.size)}
                {updated && <span className="kb-updated">щойно оновлено</span>}
              </div>
              <button type="button" className="kb-discuss" onClick={() => discuss(note)}>
                <MessageSquarePlus size={17} /> Обговорити з Hermes
              </button>
              {note.frontmatter && <Properties fm={note.frontmatter} />}
              <NoteMarkdown note={note} open={open} />
              <section className="kb-backlinks">
                <h2>
                  Посилаються сюди <span>{note.backlinks.length}</span>
                </h2>
                {note.backlinks.length === 0 && <p className="muted">Поки що жодна нотатка не посилається на цю.</p>}
                {note.backlinks.map((b) => (
                  <button key={b.path} type="button" className="kb-backlink" onClick={() => open(b.path)}>
                    <span className="kb-backlink-title">
                      <FileText size={15} /> {b.title}
                    </span>
                    {b.snippet && <span className="kb-backlink-snippet">{plainSnippet(b.snippet)}</span>}
                  </button>
                ))}
              </section>
            </>
          )}
        </article>
      </div>
    </>
  )
}

// ---------- Головна ----------

type Tree = { name: string; path: string; folders: Tree[]; notes: KbNote[]; count: number }

function buildTree(list: KbNote[]): Tree {
  const root: Tree = { name: '', path: '', folders: [], notes: [], count: 0 }
  for (const n of list) {
    let cur = root
    cur.count++
    if (n.folder) {
      let acc = ''
      for (const part of n.folder.split('/')) {
        acc = acc ? `${acc}/${part}` : part
        let next = cur.folders.find((f) => f.name === part)
        if (!next) {
          next = { name: part, path: acc, folders: [], notes: [], count: 0 }
          cur.folders.push(next)
        }
        next.count++
        cur = next
      }
    }
    cur.notes.push(n)
  }
  const sort = (t: Tree) => {
    t.folders.sort((a, b) => a.name.localeCompare(b.name, 'uk'))
    t.notes.sort((a, b) => b.mtime - a.mtime)
    t.folders.forEach(sort)
  }
  sort(root)
  return root
}

function FolderNode({ t, depth, open }: { t: Tree; depth: number; open: (p: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0)
  return (
    <div className="kb-folder">
      {depth > 0 && (
        <button type="button" className="kb-row kb-folder-row" style={{ paddingLeft: 10 + (depth - 1) * 18 }} onClick={() => setExpanded((e) => !e)}>
          <ChevronRight size={15} className={`kb-chevron ${expanded ? 'is-open' : ''}`} />
          {expanded ? <FolderOpen size={17} /> : <Folder size={17} />}
          <span className="kb-row-title">{t.name}</span>
          <span className="kb-count">{t.count}</span>
        </button>
      )}
      {expanded && (
        <>
          {t.folders.map((f) => (
            <FolderNode key={f.path} t={f} depth={depth + 1} open={open} />
          ))}
          {t.notes.map((n) => (
            <button key={n.path} type="button" className="kb-row" style={{ paddingLeft: 10 + depth * 18 + (depth > 0 ? 15 : 0) }} onClick={() => open(n.path)}>
              <FileText size={16} />
              <span className="kb-row-title">{n.title}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function Home({ go, sidebarOpen, openSidebar, version }: Props) {
  const [index, setIndex] = useState<{ available: boolean; name: string; list: KbNote[] } | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<(KbNote & { snippet: string })[] | null>(null)
  const open = useCallback((p: string) => go({ kind: 'note', path: p }), [go])

  useEffect(() => {
    kb.index().then(setIndex).catch((e: Error) => setError(e.message))
  }, [version])

  useEffect(() => {
    const q = query.trim()
    if (!q) return setResults(null)
    // Відповідь на старий запит (людина вже дописала чи стерла) відкидаємо.
    let alive = true
    const t = setTimeout(() => {
      kb.search(q)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]))
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, version])

  const tree = useMemo(() => (index ? buildTree(index.list) : null), [index])
  const recent = useMemo(() => (index ? [...index.list].sort((a, b) => b.mtime - a.mtime).slice(0, 6) : []), [index])

  return (
    <>
      <TopBar
        title="База знань"
        sidebarOpen={sidebarOpen}
        openSidebar={openSidebar}
        right={
          <button type="button" className="icon-btn m-menu-btn" aria-label="Граф" title="Граф зв’язків" onClick={() => go({ kind: 'graph' })}>
            <Network size={19} />
          </button>
        }
      />
      <div className="jobs-scroll">
        <div className="jobs-inner kb-home">
          <div className="jobs-hero">
            <h1>База знань</h1>
            <p>{index ? `${index.name} · ${index.list.length} нотаток. Hermes пише сюди сам, усе оновлюється наживо.` : 'Завантажую сховище…'}</p>
          </div>
          {error && <div className="msg-error">{error}</div>}
          {index && !index.available && <div className="msg-error">Сховище Obsidian не знайдено на сервері.</div>}
          <div className="kb-search">
            <Search size={18} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук у нотатках" enterKeyHint="search" />
            {query && (
              <button type="button" className="icon-btn" aria-label="Очистити" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            )}
          </div>

          {results ? (
            <section className="jobs-section">
              <h2>{results.length ? `Знайдено ${results.length}` : 'Нічого не знайдено'}</h2>
              <div className="kb-cards">
                {results.map((r) => (
                  <button key={r.path} type="button" className="kb-card" onClick={() => open(r.path)}>
                    <span className="kb-card-folder">{r.folder || 'Корінь'}</span>
                    <span className="kb-card-title">{r.title}</span>
                    <span className="kb-card-snippet">{plainSnippet(r.snippet)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            index && (
              <>
                <section className="jobs-section">
                  <h2>Нещодавно змінені</h2>
                  <div className="kb-cards">
                    {recent.map((n) => (
                      <button key={n.path} type="button" className="kb-card" onClick={() => open(n.path)}>
                        <span className="kb-card-folder">
                          {n.folder || 'Корінь'} · {relative(n.mtime)}
                        </span>
                        <span className="kb-card-title">{n.title}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="jobs-section">
                  <h2>Папки</h2>
                  <div className="kb-tree">{tree && <FolderNode t={tree} depth={0} open={open} />}</div>
                </section>
              </>
            )
          )}
          {index && index.list.length === 0 && (
            <div className="jobs-empty">
              <div className="jobs-empty-icon">
                <BookOpen size={30} />
              </div>
              <p>Сховище порожнє. Попроси Hermes зберегти щось в Obsidian.</p>
            </div>
          )}
          <p className="kb-foot">Останнє оновлення сторінки: {formatDate(new Date())}</p>
        </div>
      </div>
    </>
  )
}

// ---------- Граф ----------

function GraphPage({ go, back, sidebarOpen, openSidebar, route, version }: Props) {
  const [data, setData] = useState<{ nodes: { id: string; title: string; folder: string }[]; edges: [string, string][] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    kb.graph()
      .then((d) => {
        if (!alive) return
        setError('')
        // Те саме сховище без змін у зв'язках — не перебудовуємо граф, щоб він не стрибав.
        setData((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d) ? prev : d))
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [version])
  const open = useCallback((p: string) => go({ kind: 'note', path: p }), [go])
  return (
    <>
      <TopBar title="Граф зв’язків" back={back} sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
      {data ? (
        <KbGraph nodes={data.nodes} edges={data.edges} focus={route.kind === 'graph' ? route.focus : null} onOpen={open} />
      ) : error ? (
        <div className="jobs-empty">
          <p>Не вдалося завантажити граф: {error}</p>
        </div>
      ) : (
        <div className="jobs-loading">
          <Loader2 size={22} className="spin" />
        </div>
      )}
    </>
  )
}

export function KbView(props: Props) {
  const { route } = props
  return (
    <div className="jobs-view">
      {route.kind === 'note' ? <NotePage {...props} path={route.path} /> : route.kind === 'graph' ? <GraphPage {...props} /> : <Home {...props} />}
    </div>
  )
}
