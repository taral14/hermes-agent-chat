import { KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import * as passkey from '../passkey.ts'

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [methods, setMethods] = useState<{ passkeys: boolean; password: boolean } | null>(null)

  useEffect(() => {
    passkey
      .methods()
      .then((m) => {
        setMethods(m)
        // Ключ підказується прямо в полі логіна, як збережений пароль.
        if (m.passkeys && passkey.supported()) void passkey.autofillLogin().then((ok) => ok && onDone())
      })
      .catch(() => setMethods({ passkeys: false, password: true }))
    return () => passkey.cancelPending()
  }, [onDone])

  const withKey = async () => {
    setBusy('key')
    setError('')
    passkey.cancelPending()
    try {
      await passkey.login()
      onDone()
    } catch (err) {
      setError((err as Error).message)
      // Повертаємо автопідказку після невдалої спроби.
      if (methods?.passkeys) void passkey.autofillLogin().then((ok) => ok && onDone())
    } finally {
      setBusy('')
    }
  }

  const showPassword = methods?.password ?? true
  const showKey = Boolean(methods?.passkeys) && passkey.supported()

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!showPassword) return
          setBusy('password')
          setError('')
          try {
            await api.login(username, password)
            onDone()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy('')
          }
        }}
      >
        <div className="brand-mark big">H</div>
        <h1>Hermes</h1>
        {showKey && (
          <button type="button" className="btn btn-primary btn-wide key-btn" disabled={busy === 'key'} onClick={() => void withKey()}>
            {busy === 'key' ? <Loader2 size={18} className="spin" /> : <KeyRound size={18} />}
            Увійти з ключем
          </button>
        )}
        {showKey && showPassword && <div className="login-or">або</div>}
        {showPassword && (
          <>
            <input autoComplete="username webauthn" placeholder="Логін" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input type="password" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className={`btn btn-wide ${showKey ? '' : 'btn-primary'}`} disabled={busy === 'password' || !username || !password}>
              {busy === 'password' ? <Loader2 size={18} className="spin" /> : 'Увійти з паролем'}
            </button>
          </>
        )}
        {!showPassword && !showKey && methods && <div className="login-error">Цей браузер не підтримує ключі доступу.</div>}
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}
