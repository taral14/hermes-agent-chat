// Запис голосу з мікрофона для поля вводу. Формат — який уміє браузер: webm/opus (Chrome, Android)
// або mp4/aac (Safari, iPhone); сервер розпізнає обидва засобами Hermes.
import { useEffect, useRef, useState } from 'react'

/** Найдовший запис; далі зупиняємо самі. */
const MAX_SECONDS = 5 * 60

export const canRecord = () => typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia)

function pickType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}

export function useRecorder(onDone: (audio: Blob) => void, onError: (e: unknown) => void) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const discard = useRef(false)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) rec.current?.stop()
    }, 250)
    return () => clearInterval(t)
  }, [recording])

  // Чат закрили посеред запису: мікрофон звільняємо, запис викидаємо.
  useEffect(
    () => () => {
      discard.current = true
      if (rec.current?.state === 'recording') rec.current.stop()
    },
    [],
  )

  const start = async () => {
    if (rec.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      onError(new Error((e as DOMException).name === 'NotAllowedError' ? 'Немає дозволу на мікрофон' : 'Мікрофон недоступний'))
      return
    }
    const type = pickType()
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      rec.current = null
      setRecording(false)
      if (discard.current) return
      const blob = new Blob(chunks, { type: (r.mimeType || type || 'audio/webm').split(';')[0] })
      if (blob.size) done.current(blob)
    }
    discard.current = false
    rec.current = r
    r.start(1000)
    setSeconds(0)
    setRecording(true)
  }

  const stop = (keep = true) => {
    discard.current = !keep
    if (rec.current?.state === 'recording') rec.current.stop()
  }

  return { recording, seconds, start, stop }
}
