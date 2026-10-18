import { Download, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { uploadUrl } from '../api.ts'
import type { Attachment } from '../shared.ts'

const BARS = 56
const SPEEDS = [1, 1.5, 2]
const MAX_DECODE = 25 * 1024 * 1024

/** Одночасно грає лише один програвач. */
const PLAY_EVENT = 'chat:audio-play'

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** Заглушка хвилі до декодування: стабільна для файлу, щоб не «стрибала». */
function placeholder(seed: string): number[] {
  let x = 0
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    x = (x * 1103515245 + 12345) >>> 0
    return 0.25 + 0.35 * Math.abs(Math.sin(i / 3.1)) * ((x % 1000) / 1000 + 0.4)
  })
}

const peaksCache = new Map<string, number[]>()

async function decodePeaks(id: string): Promise<number[] | null> {
  const cached = peaksCache.get(id)
  if (cached) return cached
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  const res = await fetch(uploadUrl(id), { credentials: 'same-origin' })
  const buf = await res.arrayBuffer()
  const ctx = new Ctx()
  try {
    const audio = await ctx.decodeAudioData(buf)
    const data = audio.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / BARS))
    const peaks: number[] = []
    for (let b = 0; b < BARS; b++) {
      let sum = 0
      const from = b * step
      const to = Math.min(data.length, from + step)
      for (let i = from; i < to; i += 16) sum += data[i]! * data[i]!
      peaks.push(Math.sqrt(sum / Math.max(1, (to - from) / 16)))
    }
    const max = Math.max(...peaks, 1e-6)
    const norm = peaks.map((p) => 0.12 + 0.88 * Math.pow(p / max, 0.75))
    peaksCache.set(id, norm)
    return norm
  } finally {
    void ctx.close()
  }
}

export function AudioPlayer({ a }: { a: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null)
  const wave = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [peaks, setPeaks] = useState(() => peaksCache.get(a.id) ?? placeholder(a.id))
  const [real, setReal] = useState(peaksCache.has(a.id))
  const dragging = useRef(false)

  useEffect(() => {
    if (real || a.size > MAX_DECODE) return
    let alive = true
    decodePeaks(a.id)
      .then((p) => {
        if (alive && p) {
          setPeaks(p)
          setReal(true)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [a.id, a.size, real])

  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== a.id) audio.current?.pause()
    }
    window.addEventListener(PLAY_EVENT, other)
    return () => window.removeEventListener(PLAY_EVENT, other)
  }, [a.id])

  // Плавний прогрес: timeupdate на iPhone приходить рідко.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (audio.current && !dragging.current) setTime(audio.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: a.id }))
      void el.play()
    } else el.pause()
  }

  const seekTo = (e: PointerEvent<HTMLDivElement>) => {
    const el = audio.current
    const box = wave.current?.getBoundingClientRect()
    if (!el || !box || !duration) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    el.currentTime = ratio * duration
    setTime(ratio * duration)
  }

  const progress = duration ? time / duration : 0

  return (
    <div className={`audio-card ${playing ? 'is-playing' : ''}`}>
      <audio
        ref={audio}
        src={uploadUrl(a.id)}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => !dragging.current && setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setTime(0)
          if (audio.current) audio.current.currentTime = 0
        }}
      />
      <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Відтворити'}>
        {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} className="audio-play-icon" />}
      </button>
      <div className="audio-main">
        <div className="audio-top">
          <span className="audio-name" title={a.name}>
            {a.name}
          </span>
          <button
            type="button"
            className="audio-speed"
            onClick={() => {
              const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!
              setSpeed(next)
              if (audio.current) audio.current.playbackRate = next
            }}
            aria-label="Швидкість"
          >
            {speed}×
          </button>
          <a href={`${uploadUrl(a.id)}?download`} download={a.name} className="audio-dl" aria-label="Завантажити" title="Завантажити">
            <Download size={16} />
          </a>
        </div>
        <div
          ref={wave}
          className={`audio-wave ${real ? 'is-real' : ''}`}
          role="slider"
          aria-label="Позиція"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!audio.current) return
            if (e.key === 'ArrowRight') audio.current.currentTime += 5
            if (e.key === 'ArrowLeft') audio.current.currentTime -= 5
          }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekTo(e)
          }}
          onPointerMove={(e) => dragging.current && seekTo(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          {peaks.map((p, i) => (
            <span key={i} className={i / BARS < progress ? 'on' : ''} style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
        </div>
        <div className="audio-times">
          <span>{fmt(time)}</span>
          <span>{duration ? fmt(duration) : '—'}</span>
        </div>
      </div>
    </div>
  )
}
