import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setPublicFiles } from './api.ts'
import './prefs.ts'
import { ShareView } from './components/ShareView.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { registerSW } from './push.ts'
import './styles.css'

// iPhone: клавіатура зменшує лише visualViewport, а Safari прокручує сторінку, щоб показати поле вводу,
// і верхня панель виїжджає за екран. Тримаємо застосунок рівно у видимій області.
const vv = window.visualViewport
const root = document.documentElement
function syncViewport() {
  root.style.setProperty('--app-h', `${vv ? vv.height : window.innerHeight}px`)
  root.style.setProperty('--app-top', `${vv ? Math.max(0, vv.offsetTop) : 0}px`)
  // Клавіатура на iPhone зменшує лише visualViewport: так і впізнаємо, що вона відкрита.
  root.classList.toggle('kb-open', Boolean(vv && window.innerHeight - vv.height > 120))
}
vv?.addEventListener('resize', syncViewport)
vv?.addEventListener('scroll', syncViewport)
window.addEventListener('resize', syncViewport)
syncViewport()
// Поки відкрите системне вікно (вибір фото, камера), iPhone ховає клавіатуру, але resize не завжди доходить,
// і застосунок лишався б висотою «з клавіатурою». Звіряємось, коли до сторінки повертаються, ще й із затримкою:
// visualViewport оновлюється після анімації клавіатури.
function resyncSoon() {
  syncViewport()
  setTimeout(syncViewport, 300)
  setTimeout(syncViewport, 800)
}
window.addEventListener('focus', resyncSoon)
window.addEventListener('pageshow', resyncSoon)
document.addEventListener('visibilitychange', resyncSoon)
document.addEventListener('focusout', resyncSoon)
document.addEventListener('change', (e) => (e.target as HTMLInputElement | null)?.type === 'file' && resyncSoon(), true)

// /s/<токен> — спільний чат лише для перегляду: без входу, пушів і сервіс-воркера.
const shareToken = /^\/s\/([\w-]{20,})\/?$/.exec(location.pathname)?.[1]
if (shareToken) setPublicFiles(shareToken)
else void registerSW()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{shareToken ? <ShareView token={shareToken} /> : <App />}</ErrorBoundary>
  </StrictMode>,
)
