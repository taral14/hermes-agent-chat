import { Fingerprint, KeyRound, Laptop, LogOut, Loader2, Pencil, ShieldCheck, Smartphone, Trash2, Usb, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import * as passkey from '../passkey.ts'
import type { PasskeyInfo, Security as SecurityState, SessionInfo } from '../passkey.ts'
import { relative } from '../schedule.ts'

function KeyRow({ k, onChange, onError }: { k: PasskeyInfo; onChange: (s: SecurityState) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(k.name)
  const [confirm, setConfirm] = useState(false)
  const Icon = k.kind === 'security-key' ? Usb : Fingerprint
  return (
    <div className="key-row">
      <span className={`key-icon ${k.kind === 'security-key' ? 'is-hw' : ''}`}>
        <Icon size={18} />
      </span>
      <span className="key-text">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setEditing(false)
              if (name.trim() && name !== k.name) passkey.rename(k.id, name).then(onChange).catch((err: Error) => onError(err.message))
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} maxLength={60} />
          </form>
        ) : (
          <span className="key-name">{k.name}</span>
        )}
        <span className="key-meta">
          {k.kind === 'security-key' ? 'Фізичний ключ' : k.backedUp ? 'Ключ доступу · синхронізується' : 'Ключ доступу'} ·{' '}
          {k.lastUsedAt ? `вхід ${relative(k.lastUsedAt)}` : `додано ${relative(k.createdAt)}`}
        </span>
      </span>
      {confirm ? (
        <span className="key-confirm">
          <button type="button" className="btn btn-danger-solid" onClick={() => passkey.remove(k.id).then(onChange).catch((err: Error) => onError(err.message))}>
            Видалити
          </button>
          <button type="button" className="icon-btn round" aria-label="Скасувати" onClick={() => setConfirm(false)}>
            <X size={16} />
          </button>
        </span>
      ) : (
        <>
          <button type="button" className="icon-btn round" aria-label="Перейменувати" onClick={() => (setName(k.name), setEditing(true))}>
            <Pencil size={16} />
          </button>
          <button type="button" className="icon-btn round danger-icon" aria-label="Видалити" onClick={() => setConfirm(true)}>
            <Trash2 size={16} />
          </button>
        </>
      )}
    </div>
  )
}

/** «iPhone · Safari» з User-Agent. */
function deviceLabel(ua: string): { name: string; phone: boolean } {
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Пристрій'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return { name: browser ? `${device} · ${browser}` : device, phone: /iPhone|Android/.test(ua) }
}

function SessionRow({ s, onChange, onError }: { s: SessionInfo; onChange: (s: SecurityState) => void; onError: (m: string) => void }) {
  const { name, phone } = deviceLabel(s.ua)
  const Icon = phone ? Smartphone : Laptop
  return (
    <div className="key-row">
      <span className="key-icon">
        <Icon size={18} />
      </span>
      <span className="key-text">
        <span className="key-name">{name}</span>
        <span className="key-meta">{s.current ? 'Цей пристрій' : `активність ${relative(s.lastSeen)}`}{s.ip ? ` · ${s.ip}` : ''}</span>
      </span>
      {!s.current && (
        <button type="button" className="icon-btn round danger-icon" aria-label="Вийти на цьому пристрої" onClick={() => passkey.revokeSession(s.id).then(onChange).catch((err: Error) => onError(err.message))}>
          <LogOut size={16} />
        </button>
      )}
    </div>
  )
}

export function Security({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<SecurityState | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const supported = passkey.supported()

  useEffect(() => {
    passkey.security().then(setState).catch((e: Error) => setMsg(e.message))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const add = async (kind: 'device' | 'security-key') => {
    setBusy(kind)
    setMsg('')
    try {
      setState(await passkey.register(kind))
      setMsg(kind === 'security-key' ? 'Фізичний ключ додано' : 'Ключ доступу додано')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Безпека" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>Вхід і безпека</h2>
          <button type="button" className="icon-btn round" onClick={onClose} aria-label="Закрити">
            <X size={20} />
          </button>
        </div>

        {!state ? (
          <div className="jobs-loading">
            <Loader2 size={22} className="spin" />
          </div>
        ) : (
          <>
            <p className="sheet-lead">
              Ключ доступу — це вхід через Face ID чи Touch ID, без пароля. Фізичний ключ (YubiKey тощо) торкаєш або вставляєш у телефон чи Mac.
            </p>
            {state.passkeys.length > 0 && (
              <div className="key-list">
                {state.passkeys.map((k) => (
                  <KeyRow key={k.id} k={k} onChange={setState} onError={setMsg} />
                ))}
              </div>
            )}
            {supported ? (
              <div className="key-add">
                <button type="button" className="key-add-btn" disabled={!!busy} onClick={() => void add('device')}>
                  <span className="key-icon">{busy === 'device' ? <Loader2 size={18} className="spin" /> : <Fingerprint size={18} />}</span>
                  <span className="key-text">
                    <span className="key-name">Додати ключ доступу</span>
                    <span className="key-meta">Face ID, Touch ID або менеджер паролів</span>
                  </span>
                </button>
                <button type="button" className="key-add-btn" disabled={!!busy} onClick={() => void add('security-key')}>
                  <span className="key-icon is-hw">{busy === 'security-key' ? <Loader2 size={18} className="spin" /> : <KeyRound size={18} />}</span>
                  <span className="key-text">
                    <span className="key-name">Додати фізичний ключ</span>
                    <span className="key-meta">YubiKey чи інший ключ через USB, NFC або Bluetooth</span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="notif-msg">Цей браузер не підтримує ключі доступу.</div>
            )}

            <label className={`notif-row pw-row ${state.passkeys.length ? '' : 'is-disabled'}`}>
              <span className="notif-row-icon">
                <ShieldCheck size={18} />
              </span>
              <span className="notif-row-text">
                <span className="notif-row-title">Вхід за паролем</span>
                <span className="notif-row-hint">
                  {state.passkeys.length
                    ? state.passwordLogin
                      ? 'Вимкни, щоб увійти можна було лише з ключем'
                      : 'Вимкнено: увійти можна лише з ключем'
                    : 'Щоб вимкнути пароль, спершу додай ключ'}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={state.passwordLogin}
                disabled={!state.passkeys.length || busy === 'pw'}
                className={`switch ${state.passwordLogin ? 'is-on' : ''}`}
                onClick={() => {
                  setBusy('pw')
                  passkey
                    .setPasswordLogin(!state.passwordLogin)
                    .then(setState)
                    .catch((e: Error) => setMsg(e.message))
                    .finally(() => setBusy(''))
                }}
              >
                <span className="switch-knob" />
              </button>
            </label>
            {!state.passwordLogin && (
              <p className="notif-foot">Якщо загубиш усі ключі: додай рядок allow_password: true у config.yaml чату на сервері.</p>
            )}

            <div className="sec-label">Де виконано вхід</div>
            <div className="key-list">
              {state.sessions.map((s) => (
                <SessionRow key={s.id} s={s} onChange={setState} onError={setMsg} />
              ))}
            </div>
            {state.sessions.some((s) => !s.current) && (
              <button
                type="button"
                className="sec-revoke"
                disabled={busy === 'revoke'}
                onClick={() => {
                  setBusy('revoke')
                  passkey
                    .revokeOtherSessions()
                    .then(setState)
                    .catch((e: Error) => setMsg(e.message))
                    .finally(() => setBusy(''))
                }}
              >
                Вийти на всіх інших пристроях
              </button>
            )}
          </>
        )}
        {msg && <div className="notif-msg">{msg}</div>}
      </div>
    </div>,
    document.body,
    )
  )
}
