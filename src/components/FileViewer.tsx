// Переглядач файлів поверх чату: PDF, картинки, текст. Закривається хрестиком, Escape і жестом «назад»,
// тож у застосунку на телефоні файл більше не відкривається замість чату без шляху назад.
import { Download, Loader2, X } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { on } from '../bus.ts'
import { formatSize } from '../fileKind.ts'
import { type ViewFile, viewKind } from '../viewer.ts'
import { Markdown } from './Markdown.tsx'
import { useEscapeLayer } from './ui/layers.ts'

/** PDF.js важить ~1,5 МБ: вантажимо, лише коли відкривають PDF. */
const PdfView = lazy(() => import('./PdfView.tsx'))

/** Смужка «скільки вже завантажено»: щоб було видно, що файл іде, а не все зависло. */
export function Progress({ loaded, total, label = 'Завантажую' }: { loaded: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null
  return (
    <div className="viewer-progress" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className="viewer-progress-text">
        <Loader2 size={16} className="spin" />
        {label} {total > 0 ? `${formatSize(loaded)} з ${formatSize(total)}` : loaded ? formatSize(loaded) : '…'}
      </div>
      <div className="viewer-progress-bar">
        <span style={pct === null ? undefined : { width: `${pct}%` }} className={pct === null ? 'is-indeterminate' : ''} />
      </div>
    </div>
  )
}

/** Завантажити файл цілком, повідомляючи про прогрес (Content-Length — з відповіді сервера). */
async function fetchBlob(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Blob> {
  const res = await fetch(url, { signal, credentials: 'same-origin' })
  if (!res.ok) throw new Error(res.status === 410 ? 'Файл переміщено або видалено з сервера' : `Сервер відповів ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body) return res.blob()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress(loaded, total)
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' })
}

/** Картинка чи текст: вантажимо з прогресом, потім показуємо. */
function BlobView({ file, kind }: { file: ViewFile; kind: 'image' | 'text' }) {
  const [progress, setProgress] = useState({ loaded: 0, total: file.size })
  const [src, setSrc] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    const ctl = new AbortController()
    let url: string | null = null
    fetchBlob(file.url, ctl.signal, (loaded, total) => setProgress({ loaded, total: total || file.size }))
      .then(async (blob) => {
        if (kind === 'text') setText(await blob.text())
        else setSrc((url = URL.createObjectURL(blob)))
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => {
      ctl.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.url, file.size, kind])

  if (error) return <div className="viewer-message">{error}</div>
  if (kind === 'image' && src)
    return (
      <div className={`viewer-image ${zoom ? 'is-zoomed' : ''}`} onClick={() => setZoom(!zoom)}>
        <img src={src} alt={file.name} />
      </div>
    )
  if (kind === 'text' && text !== null)
    return (
      <div className="viewer-text">
        {/\.(md|markdown)$/i.test(file.name) ? <Markdown text={text} /> : <pre>{text}</pre>}
      </div>
    )
  return <Progress loaded={progress.loaded} total={progress.total} />
}

export function FileViewer({ file, onClose }: { file: ViewFile; onClose: () => void }) {
  const kind = viewKind(file.name, file.mime, file.size)
  const closing = useRef(false)
  const close = useRef(onClose)
  close.current = onClose
  useEscapeLayer(onClose)

  // Свій запис в історії: жест «назад» на телефоні закриває переглядач, а не застосунок. Один раз на відкриття.
  useEffect(() => {
    history.pushState({ ...(history.state as object | null), viewer: true }, '')
    const onPop = () => {
      closing.current = true
      close.current()
    }
    window.addEventListener('popstate', onPop)
    document.body.classList.add('viewer-open')
    return () => {
      window.removeEventListener('popstate', onPop)
      document.body.classList.remove('viewer-open')
      if (!closing.current && (history.state as { viewer?: boolean } | null)?.viewer) history.back()
    }
  }, [])

  const download = `${file.url}${file.url.includes('?') ? '&' : '?'}download`
  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={file.name}>
      <header className="viewer-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрити">
          <X size={22} />
        </button>
        <span className="viewer-title">
          <b>{file.name}</b>
          <small>{formatSize(file.size)}</small>
        </span>
        <a className="icon-btn" href={download} download={file.name} aria-label="Завантажити" title="Завантажити">
          <Download size={20} />
        </a>
      </header>
      <div className="viewer-body">
        {kind === 'pdf' ? (
          <Suspense fallback={<Progress loaded={0} total={0} label="Відкриваю переглядач" />}>
            <PdfView file={file} />
          </Suspense>
        ) : kind ? (
          <BlobView file={file} kind={kind} />
        ) : (
          <div className="viewer-message">Цей файл не відкривається в браузері. Завантаж його кнопкою вгорі.</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Слухає «відкрити файл» з будь-якого місця (картки вкладень) і показує переглядач. */
export function FileViewerHost() {
  const [file, setFile] = useState<ViewFile | null>(null)
  useEffect(() => on('file', setFile), [])
  return file ? <FileViewer key={file.url} file={file} onClose={() => setFile(null)} /> : null
}
