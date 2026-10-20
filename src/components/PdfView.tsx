// PDF у переглядачі: PDF.js тягне файл шматками (Range), тож перша сторінка великого PDF з'являється
// одразу. Сторінки малюються, лише коли вони біля екрана, а далекі звільняють пам'ять (на iPhone її мало).
import { Loader2, Minus, Plus } from 'lucide-react'
import { GlobalWorkerOptions, type PDFDocumentProxy, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { ViewFile } from '../viewer.ts'
import { Progress } from './FileViewer.tsx'

GlobalWorkerOptions.workerSrc = workerUrl
/** JS-декодери JPEG 2000 / JBIG2 (див. vite.config.ts). */
const DECODERS = import.meta.env.DEV ? '/node_modules/pdfjs-dist/wasm/' : '/pdfjs/'
const ZOOMS = [1, 1.5, 2, 3]
/** Більший canvas iOS просто не намалює. */
const MAX_PIXELS = 16_000_000
const GAP = 12

function PdfPage({ doc, n, width, ratio, root }: { doc: PDFDocumentProxy; n: number; width: number; ratio: number; root: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [own, setOwn] = useState<number | null>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setNear(Boolean(e?.isIntersecting)), { root, rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    const c = canvas.current
    if (!near || !c || !width) return
    let task: { cancel: () => void } | null = null
    let alive = true
    void doc.getPage(n).then((page) => {
      if (!alive) return
      const base = page.getViewport({ scale: 1 })
      setOwn(base.height / base.width)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      let scale = (width / base.width) * dpr
      const pixels = base.width * base.height * scale * scale
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels)
      const viewport = page.getViewport({ scale })
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      const t = page.render({ canvas: c, viewport })
      task = t
      t.promise.then(() => alive && setDrawn(true)).catch(() => {})
    })
    return () => {
      alive = false
      task?.cancel()
      // Сторінка далеко: віддаємо пам'ять canvas.
      c.width = 0
      c.height = 0
      setDrawn(false)
    }
  }, [near, doc, n, width])

  return (
    <div ref={box} className="pdf-page" style={{ width, height: Math.round(width * (own ?? ratio)) }}>
      <canvas ref={canvas} />
      {!drawn && (
        <span className="pdf-page-wait">
          <Loader2 size={20} className="spin" />
        </span>
      )}
    </div>
  )
}

export default function PdfView({ file }: { file: ViewFile }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [ratio, setRatio] = useState(Math.SQRT2)
  const [progress, setProgress] = useState({ loaded: 0, total: file.size })
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(0)
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const task = getDocument({
      url: new URL(file.url, location.href).href,
      // Шматками по 512 КБ і лише те, що треба: перша сторінка не чекає всього файлу.
      rangeChunkSize: 512 * 1024,
      disableAutoFetch: true,
      useWasm: false,
      wasmUrl: DECODERS,
    })
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => setProgress({ loaded, total: total || file.size })
    task.promise
      .then(async (d) => {
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        setRatio(first.height / first.width)
        setDoc(d)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortException') setError(e.name === 'MissingPDFException' || /410/.test(e.message) ? 'Файл переміщено або видалено з сервера' : 'Не вдалося відкрити PDF')
      })
    return () => void task.destroy()
  }, [file.url, file.size])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.min(el.clientWidth - 24, 1100)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const pageWidth = Math.round(width * ZOOMS[zoom]!)
  const onScroll = () => {
    const el = scroller.current
    if (!el || !doc) return
    const step = pageWidth * ratio + GAP
    setPage(Math.min(doc.numPages, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / step) + 1)))
  }

  if (error) return <div className="viewer-message">{error}</div>
  if (!doc) return <Progress loaded={progress.loaded} total={progress.total} />
  return (
    <>
      <div ref={scroller} className="pdf-scroll" onScroll={onScroll}>
        <div className="pdf-pages" style={{ gap: GAP }}>
          {width > 0 &&
            Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} n={i + 1} width={pageWidth} ratio={ratio} root={scroller.current} />
            ))}
        </div>
      </div>
      <div className="pdf-bar">
        <span>
          {page} / {doc.numPages}
        </span>
        <button type="button" className="icon-btn" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} aria-label="Зменшити">
          <Minus size={18} />
        </button>
        <span>{Math.round(ZOOMS[zoom]! * 100)}%</span>
        <button type="button" className="icon-btn" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} aria-label="Збільшити">
          <Plus size={18} />
        </button>
      </div>
    </>
  )
}
