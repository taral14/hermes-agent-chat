// Шапка сторінок «Розклад» і «База знань»: назад або кнопка панелі, назва, дії праворуч.
import { ChevronLeft, Menu, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'

export function TopBar({ title, back, right, sidebarOpen, openSidebar }: {
  title: string
  back?: () => void
  right?: ReactNode
  sidebarOpen: boolean
  openSidebar: () => void
}) {
  return (
    <header className="topbar jobs-topbar">
      <div className="topbar-left">
        {back ? (
          <button type="button" className="icon-btn" onClick={back} aria-label="Назад">
            <ChevronLeft size={22} />
          </button>
        ) : (
          !sidebarOpen && (
            <button type="button" className="icon-btn" onClick={openSidebar} aria-label="Показати панель">
              <span className="only-wide">
                <PanelLeftOpen size={20} />
              </span>
              <span className="only-narrow">
                <Menu size={20} />
              </span>
            </button>
          )
        )}
        <span className="jobs-topbar-title">{title}</span>
      </div>
      {right}
    </header>
  )
}
