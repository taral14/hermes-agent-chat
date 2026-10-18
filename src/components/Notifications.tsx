import { Bell, BellOff, CalendarClock, Loader2, MessageSquareText, Share, ShieldAlert, SquarePlus, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import * as push from '../push.ts'
import type { PushSettings } from '../shared.ts'

type State = 'loading' | 'install' | 'unsupported' | 'denied' | 'off' | 'on'

function Row({ icon, title, hint, on, onChange }: { icon: ReactNode; title: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="notif-row">
      <span className="notif-row-icon">{icon}</span>
      <span className="notif-row-text">
        <span className="notif-row-title">{title}</span>
        <span className="notif-row-hint">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch-knob" />
      </button>
    </label>
  )
}

export function Notifications({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>('loading')
  const [settings, setSettings] = useState<PushSettings | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void (async () => {
      if (!push.pushSupported()) return setState(push.isIOS() && !push.isStandalone() ? 'install' : 'unsupported')
      if (Notification.permission === 'denied') return setState('denied')
      try {
        const s = await push.status()
        setSettings(s)
        setState(s ? 'on' : 'off')
      } catch {
        setState('off')
      }
    })()
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg((e as Error).message)
      if (Notification.permission === 'denied') setState('denied')
    } finally {
      setBusy('')
    }
  }

  const toggle = (k: keyof PushSettings, v: boolean) => {
    setSettings((s) => (s ? { ...s, [k]: v } : s))
    push.update({ [k]: v }).then(setSettings).catch((e: Error) => setMsg(e.message))
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Сповіщення" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>Сповіщення</h2>
          <button type="button" className="icon-btn round" onClick={onClose} aria-label="Закрити">
            <X size={20} />
          </button>
        </div>

        {state === 'loading' && (
          <div className="jobs-loading">
            <Loader2 size={22} className="spin" />
          </div>
        )}

        {state === 'install' && (
          <div className="notif-hero">
            <div className="notif-badge">
              <Bell size={28} />
            </div>
            <p>На iPhone сповіщення працюють лише в застосунку з Початкового екрана. Це займе пів хвилини:</p>
            <ol className="steps">
              <li>
                <span className="step-n">1</span>
                <span>
                  Натисни <Share size={16} className="inline-icon" /> <b>Поділитися</b> внизу Safari
                </span>
              </li>
              <li>
                <span className="step-n">2</span>
                <span>
                  Обери <SquarePlus size={16} className="inline-icon" /> <b>На Початковий екран</b>
                </span>
              </li>
              <li>
                <span className="step-n">3</span>
                <span>
                  Відкрий <b>Hermes</b> з іконки й увімкни сповіщення тут
                </span>
              </li>
            </ol>
          </div>
        )}

        {state === 'unsupported' && (
          <div className="notif-hero">
            <div className="notif-badge is-muted">
              <BellOff size={28} />
            </div>
            <p>Цей браузер не підтримує веб-сповіщення.</p>
          </div>
        )}

        {state === 'denied' && (
          <div className="notif-hero">
            <div className="notif-badge is-muted">
              <BellOff size={28} />
            </div>
            <p>
              Сповіщення заборонені для цього сайту. Дозволь їх у налаштуваннях{' '}
              {push.isIOS() ? 'iPhone: Параметри → Сповіщення → Hermes' : 'браузера (значок замка біля адреси)'} і відкрий це вікно знову.
            </p>
          </div>
        )}

        {state === 'off' && (
          <div className="notif-hero">
            <div className="notif-badge">
              <Bell size={28} />
            </div>
            <p>Дізнавайся, коли Hermes закінчив задачу або чекає на твій дозвіл, навіть коли чат закритий.</p>
            <button
              type="button"
              className="btn btn-primary btn-wide"
              disabled={busy === 'enable'}
              onClick={() =>
                void run('enable', async () => {
                  setSettings(await push.enable())
                  setState('on')
                })
              }
            >
              {busy === 'enable' ? <Loader2 size={18} className="spin" /> : 'Увімкнути на цьому пристрої'}
            </button>
          </div>
        )}

        {state === 'on' && settings && (
          <>
            <div className="notif-list">
              <Row
                icon={<MessageSquareText size={18} />}
                title="Відповіді"
                hint="Hermes закінчив задачу в чаті, який зараз не відкритий"
                on={settings.replies}
                onChange={(v) => toggle('replies', v)}
              />
              <Row
                icon={<ShieldAlert size={18} />}
                title="Дозволи й уточнення"
                hint="Hermes чекає на рішення. На Mac можна відповісти просто зі сповіщення"
                on={settings.prompts}
                onChange={(v) => toggle('prompts', v)}
              />
              <Row
                icon={<CalendarClock size={18} />}
                title="Розклад"
                hint="Задача за розкладом виконалась або впала (крім службових скриптів)"
                on={settings.jobs}
                onChange={(v) => toggle('jobs', v)}
              />
            </div>
            <div className="notif-actions">
              <button type="button" className="btn" disabled={busy === 'test'} onClick={() => void run('test', async () => { await push.test(); setMsg('Надіслано — перевір сповіщення') })}>
                {busy === 'test' ? <Loader2 size={16} className="spin" /> : 'Надіслати тестове'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy === 'off'}
                onClick={() =>
                  void run('off', async () => {
                    await push.disable()
                    setSettings(null)
                    setState('off')
                  })
                }
              >
                Вимкнути
              </button>
            </div>
            <p className="notif-foot">Налаштування діють лише для цього пристрою.</p>
          </>
        )}
        {msg && <div className="notif-msg">{msg}</div>}
      </div>
    </div>
  )
}
