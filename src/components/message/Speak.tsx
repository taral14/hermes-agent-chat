// «Прочитати вголос»: озвучку відповіді робить сервер (Hermes TTS або голос macOS), тут лише програвання.
// Один спільний програвач на весь чат: нова озвучка зупиняє попередню, а аудіовкладення — її.
import { AlertTriangle, Loader2, Square, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { emit, on } from '../../bus.ts'

type State = 'idle' | 'loading' | 'playing' | 'error'

let audio: HTMLAudioElement | null = null
let owner: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())
let state: State = 'idle'

function set(s: State) {
  state = s
  notify()
}

function player(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  a.preload = 'auto'
  a.addEventListener('playing', () => set('playing'))
  a.addEventListener('waiting', () => state === 'playing' && set('loading'))
  a.addEventListener('ended', () => set('idle'))
  a.addEventListener('error', () => a.src && set('error'))
  // Почав грати аудіоплеєр вкладення: озвучку зупиняємо.
  on('audio-play', (id) => id !== 'speech' && stop())
  audio = a
  return a
}

function stop() {
  if (!audio) return
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  owner = null
  set('idle')
}

/** Почати озвучку: src і play() — прямо в обробнику натискання, інакше iPhone не дасть грати. */
function play(messageId: string) {
  const a = player()
  owner = messageId
  set('loading')
  a.src = `/api/messages/${messageId}/speech`
  emit('audio-play', 'speech')
  a.play().catch((e: DOMException) => e.name !== 'AbortError' && owner === messageId && set('error'))
}

export function SpeakButton({ messageId }: { messageId: string }) {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => void listeners.delete(f)
  }, [])
  const mine = owner === messageId
  const s: State = mine ? state : 'idle'
  const label = s === 'loading' ? 'Готую озвучку… (натисни, щоб скасувати)' : s === 'playing' ? 'Зупинити' : s === 'error' ? 'Не вдалося озвучити. Ще раз?' : 'Прочитати вголос'
  return (
    <button type="button" className={`icon-btn ${s === 'playing' ? 'is-speaking' : ''}`} title={label} aria-label={label} onClick={() => (mine && (s === 'loading' || s === 'playing') ? stop() : play(messageId))}>
      {s === 'loading' ? <Loader2 size={16} className="spin" /> : s === 'playing' ? <Square size={14} fill="currentColor" /> : s === 'error' ? <AlertTriangle size={16} /> : <Volume2 size={16} />}
    </button>
  )
}
