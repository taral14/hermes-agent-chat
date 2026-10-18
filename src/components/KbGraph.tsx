import { useEffect, useRef, useState } from 'react'

type Node = { id: string; title: string; folder: string; x: number; y: number; vx: number; vy: number; deg: number }
type Props = {
  nodes: { id: string; title: string; folder: string }[]
  edges: [string, string][]
  focus?: string | null
  onOpen: (id: string) => void
}

const PALETTE = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#84cc16', '#f97316']

export function folderColor(folders: string[], folder: string) {
  const i = folders.indexOf(folder)
  return i < 0 ? '#9ca3af' : PALETTE[i % PALETTE.length]!
}

/** Розкладка графа силовим методом: відштовхування вузлів, пружини вздовж зв'язків, тяжіння до центру. */
function layout(nodes: Node[], edges: [number, number][]) {
  const n = nodes.length
  const k = Math.sqrt((900 * 900) / Math.max(1, n))
  for (let iter = 0; iter < 320; iter++) {
    const t = 1 - iter / 320
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 0.25
        }
        const f = (k * k) / d2
        a.vx += dx * f * 0.02
        a.vy += dy * f * 0.02
        b.vx -= dx * f * 0.02
        b.vy -= dy * f * 0.02
      }
    }
    for (const [i, j] of edges) {
      const a = nodes[i]!
      const b = nodes[j]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = ((d - k * 0.8) / d) * 0.06
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }
    for (const p of nodes) {
      // Нотатки без зв'язків тягнемо до центру сильніше: вони лягають кільцем довкола мережі, як в Obsidian.
      const g = p.deg ? 0.012 : 0.035
      p.vx -= p.x * g
      p.vy -= p.y * g
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      const max = 40 * t + 1
      if (speed > max) {
        p.vx = (p.vx / speed) * max
        p.vy = (p.vy / speed) * max
      }
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.5
      p.vy *= 0.5
    }
  }
}

export function KbGraph({ nodes: input, edges: inputEdges, focus, onOpen }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<{
    nodes: Node[]
    edges: [number, number][]
    view: { x: number; y: number; s: number }
    /** Вписати граф у полотно при першому малюванні (до того розмір невідомий). */
    fit: string | null
    hover: number
    folders: string[]
    neighbors: Map<number, Set<number>>
  } | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const draw = useRef<() => void>(() => {})

  // Розкладка один раз на набір даних.
  useEffect(() => {
    const index = new Map(input.map((n, i) => [n.id, i]))
    const edges = inputEdges.map(([a, b]) => [index.get(a)!, index.get(b)!] as [number, number]).filter(([a, b]) => a != null && b != null)
    const deg = Array.from({ length: input.length }, () => 0)
    const neighbors = new Map<number, Set<number>>()
    for (const [a, b] of edges) {
      deg[a]!++
      deg[b]!++
      if (!neighbors.has(a)) neighbors.set(a, new Set())
      if (!neighbors.has(b)) neighbors.set(b, new Set())
      neighbors.get(a)!.add(b)
      neighbors.get(b)!.add(a)
    }
    const fs = [...new Set(input.map((n) => n.folder))].sort((a, b) => a.localeCompare(b, 'uk'))
    setFolders(fs)
    // Старт: вузли однієї папки поруч, щоб розкладка збиралась у зрозумілі кластери.
    const nodes: Node[] = input.map((n, i) => {
      const fi = fs.indexOf(n.folder)
      const angle = (fi / Math.max(1, fs.length)) * Math.PI * 2
      return {
        ...n,
        x: Math.cos(angle) * 300 + (Math.random() - 0.5) * 120,
        y: Math.sin(angle) * 300 + (Math.random() - 0.5) * 120,
        vx: 0,
        vy: 0,
        deg: deg[i]!,
      }
    })
    layout(nodes, edges)
    state.current = { nodes, edges, view: { x: 0, y: 0, s: 0.55 }, fit: focus ?? '', hover: -1, folders: fs, neighbors }
    draw.current()
  }, [input, inputEdges, focus])

  // Малювання.
  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    const dark = document.documentElement.dataset.scheme === 'dark'
    const render = () => {
      const st = state.current
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr
        el.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (!st) return
      if (st.fit !== null && w > 0 && h > 0) {
        // Увесь граф у кадрі; якщо відкрили з нотатки — центр на ній і її сусідах.
        const fi = st.fit ? st.nodes.findIndex((n) => n.id === st.fit) : -1
        const pick = fi >= 0 ? [fi, ...(st.neighbors.get(fi) ?? [])] : st.nodes.map((_, i) => i)
        const xs = pick.map((i) => st.nodes[i]!.x)
        const ys = pick.map((i) => st.nodes[i]!.y)
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const pad = 60
        const s = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2 - 90) / Math.max(1, maxY - minY))
        st.view = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 + 30 / Math.max(0.1, s), s: Math.min(fi >= 0 ? 1.6 : 1.2, Math.max(0.12, s)) }
        st.fit = null
      }
      const { view } = st
      const tx = (x: number) => w / 2 + (x + view.x) * view.s
      const ty = (y: number) => h / 2 + (y + view.y) * view.s
      const focusIdx = focus ? st.nodes.findIndex((n) => n.id === focus) : -1
      const active = st.hover >= 0 ? st.hover : focusIdx
      const near = active >= 0 ? st.neighbors.get(active) ?? new Set<number>() : null
      const labels: { i: number; x: number; y: number; dim: boolean; prio: number }[] = []
      ctx.lineWidth = 1
      for (const [a, b] of st.edges) {
        const lit = near && (a === active || b === active)
        ctx.strokeStyle = lit ? (dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)') : dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
        ctx.beginPath()
        ctx.moveTo(tx(st.nodes[a]!.x), ty(st.nodes[a]!.y))
        ctx.lineTo(tx(st.nodes[b]!.x), ty(st.nodes[b]!.y))
        ctx.stroke()
      }
      st.nodes.forEach((n, i) => {
        const dim = near && i !== active && !near.has(i)
        const r = (3 + Math.sqrt(n.deg) * 1.8) * Math.max(0.7, Math.min(1.6, view.s * 1.4))
        ctx.globalAlpha = dim ? 0.25 : 1
        ctx.fillStyle = folderColor(st.folders, n.folder)
        ctx.beginPath()
        ctx.arc(tx(n.x), ty(n.y), r, 0, Math.PI * 2)
        ctx.fill()
        if (i === active) {
          ctx.lineWidth = 2.5
          ctx.strokeStyle = dark ? '#fff' : '#000'
          ctx.stroke()
          ctx.lineWidth = 1
        }
        const showLabel = i === active || (near && near.has(i)) || view.s > 1.15 || n.deg >= 8
        if (showLabel) labels.push({ i, x: tx(n.x), y: ty(n.y) + r + 13, dim: Boolean(dim), prio: i === active ? 1e9 : n.deg + (near?.has(i) ? 1000 : 0) })
      })
      // Підписи без накладок: спершу важливіші (активна нотатка, сусіди, вузли з багатьма зв'язками).
      labels.sort((a, b) => b.prio - a.prio)
      const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
      ctx.textAlign = 'center'
      for (const l of labels) {
        const n = st.nodes[l.i]!
        const main = l.i === active
        ctx.font = `${main ? 600 : 500} ${main ? 14 : 12}px ui-sans-serif, -apple-system, system-ui, sans-serif`
        const label = n.title.length > 34 ? n.title.slice(0, 32) + '…' : n.title
        const wdt = ctx.measureText(label).width
        const box = { x0: l.x - wdt / 2 - 3, x1: l.x + wdt / 2 + 3, y0: l.y - 12, y1: l.y + 4 }
        if (!main && placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue
        placed.push(box)
        ctx.globalAlpha = l.dim ? 0.3 : 1
        // Підкладка під текстом, щоб його не перекреслювали лінії.
        ctx.fillStyle = dark ? 'rgba(33,33,33,0.85)' : 'rgba(255,255,255,0.85)'
        ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)
        ctx.fillStyle = dark ? '#ececec' : '#0d0d0d'
        ctx.fillText(label, l.x, l.y)
      }
      ctx.globalAlpha = 1
    }
    draw.current = () => requestAnimationFrame(render)
    draw.current()
    const ro = new ResizeObserver(() => draw.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [focus])

  // Жести: перетягування, масштаб коліщатком і двома пальцями, натискання на вузол.
  useEffect(() => {
    const el = canvas.current!
    const pointers = new Map<number, { x: number; y: number }>()
    let moved = false
    let pinch = 0
    const toWorld = (cx: number, cy: number) => {
      const st = state.current!
      const r = el.getBoundingClientRect()
      return { x: (cx - r.left - r.width / 2) / st.view.s - st.view.x, y: (cy - r.top - r.height / 2) / st.view.s - st.view.y }
    }
    const hit = (cx: number, cy: number) => {
      const st = state.current
      if (!st) return -1
      const p = toWorld(cx, cy)
      let best = -1
      let bestD = (18 / st.view.s) ** 2
      st.nodes.forEach((n, i) => {
        const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    }
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = false
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      }
    }
    const move = (e: PointerEvent) => {
      const st = state.current
      if (!st) return
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        if (e.pointerType === 'mouse') {
          const h = hit(e.clientX, e.clientY)
          if (h !== st.hover) {
            st.hover = h
            el.style.cursor = h >= 0 ? 'pointer' : 'grab'
            draw.current()
          }
        }
        return
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch) st.view.s = Math.min(4, Math.max(0.15, st.view.s * (d / pinch)))
        pinch = d
        moved = true
      } else {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
        st.view.x += dx / st.view.s
        st.view.y += dy / st.view.s
      }
      draw.current()
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = 0
      if (!moved && pointers.size === 0) {
        const h = hit(e.clientX, e.clientY)
        if (h >= 0) onOpen(state.current!.nodes[h]!.id)
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const st = state.current
      if (!st) return
      st.view.s = Math.min(4, Math.max(0.15, st.view.s * Math.exp(-e.deltaY * 0.0015)))
      draw.current()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [onOpen])

  return (
    <div className="kb-graph">
      <canvas ref={canvas} />
      <div className="kb-legend">
        {folders.map((f) => (
          <span key={f || '—'} className="kb-legend-item">
            <span className="kb-dot" style={{ background: folderColor(folders, f) }} />
            {f || 'Корінь'}
          </span>
        ))}
      </div>
    </div>
  )
}
