import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api.ts'

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await api.login(username, password)
            onDone()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="brand-mark big">H</div>
        <h1>Hermes</h1>
        <input autoFocus autoComplete="username" placeholder="Логін" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-wide" disabled={busy || !username || !password}>
          {busy ? <Loader2 size={18} className="spin" /> : 'Увійти'}
        </button>
      </form>
    </div>
  )
}
