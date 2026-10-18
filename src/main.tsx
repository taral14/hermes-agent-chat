import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

// iPhone: клавіатура зменшує лише visualViewport, а Safari прокручує сторінку, щоб показати поле вводу,
// і верхня панель виїжджає за екран. Тримаємо застосунок рівно у видимій області.
const vv = window.visualViewport
const root = document.documentElement
function syncViewport() {
  root.style.setProperty('--app-h', `${vv ? vv.height : window.innerHeight}px`)
  root.style.setProperty('--app-top', `${vv ? Math.max(0, vv.offsetTop) : 0}px`)
}
vv?.addEventListener('resize', syncViewport)
vv?.addEventListener('scroll', syncViewport)
window.addEventListener('resize', syncViewport)
syncViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
