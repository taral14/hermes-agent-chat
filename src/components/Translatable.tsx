// Текст англійською з кнопкою «Перекласти»: переклад робить допоміжна модель Hermes (див. server/translate.ts).
import { Languages, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api.ts'
import { looksEnglish } from '../lang.ts'

/** Переклади за цей сеанс: повторне відкриття картки не питає сервер (а сервер — модель) ще раз. */
const memo = new Map<string, string>()


export function Translatable({ text, className = '' }: { text: string; className?: string }) {
  const [translated, setTranslated] = useState<string | null>(() => memo.get(text) ?? null)
  const [showing, setShowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!looksEnglish(text)) return <p className={className}>{text}</p>

  const toggle = async () => {
    setError('')
    if (showing) return setShowing(false)
    if (translated) return setShowing(true)
    setBusy(true)
    try {
      const [t] = (await api.translate([text])).translations
      memo.set(text, t!)
      setTranslated(t!)
      setShowing(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="translatable">
      <p className={className}>{showing && translated ? translated : text}</p>
      <button type="button" className="translate-btn" disabled={busy} onClick={() => void toggle()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Languages size={14} />}
        {busy ? 'Перекладаю…' : showing ? 'Показати оригінал' : 'Перекласти'}
      </button>
      {error && <span className="field-hint is-error">{error}</span>}
    </div>
  )
}
