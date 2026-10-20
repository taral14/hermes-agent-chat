// Сторінка «Плагіни»: три вкладки над тим, що вміє сам Hermes.
import { Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { type PluginTab, navigateTo, pluginsUrl } from '../../router.ts'
import { TopBar } from '../ui/TopBar.tsx'
import { ExtensionsTab } from './Extensions.tsx'
import { ServicesTab } from './Services.tsx'
import { SkillsTab } from './Skills.tsx'

const TABS: { tab: PluginTab; label: string; lead: string; search: string }[] = [
  { tab: 'services', label: 'Сервіси', lead: 'Сервіси, якими Hermes користується в розмовах і задачах.', search: 'Пошук сервісів' },
  { tab: 'extensions', label: 'Розширення', lead: 'Плагіни Hermes: нові інструменти, голоси, пам’ять і платформи.', search: 'Пошук розширень' },
  { tab: 'skills', label: 'Навички', lead: 'Інструкції, за якими Hermes робить конкретні справи.', search: 'Пошук навичок' },
]

type Props = {
  tab: PluginTab
  id: string | null
  sidebarOpen: boolean
  openSidebar: () => void
  version: number
}

export function PluginsView({ tab, id, sidebarOpen, openSidebar, version }: Props) {
  const [query, setQuery] = useState<Record<PluginTab, string>>({ services: '', extensions: '', skills: '' })
  /** Картку відкрили зі списку: «Закрити» = крок назад в історії, а не новий запис. */
  const fromList = useRef(false)
  const meta = TABS.find((t) => t.tab === tab)!

  const props = {
    q: query[tab],
    id,
    version,
    open: (next: string) => {
      fromList.current = true
      navigateTo(pluginsUrl(tab, next))
    },
    close: () => {
      if (fromList.current) history.back()
      else navigateTo(pluginsUrl(tab), true)
      fromList.current = false
    },
  }

  return (
    <>
      <TopBar title="Плагіни" sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
      <div className="jobs-scroll">
        <div className="jobs-inner">
          <div className="jobs-hero">
            <h1>Плагіни</h1>
            <p>{meta.lead}</p>
          </div>

          <div className="seg seg-wide plugin-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={t.tab === tab}
                className={t.tab === tab ? 'is-on' : ''}
                onClick={() => t.tab !== tab && navigateTo(pluginsUrl(t.tab), true)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="plugin-search">
            <Search size={18} />
            <input type="search" placeholder={meta.search} value={query[tab]} onChange={(e) => setQuery({ ...query, [tab]: e.target.value })} />
          </label>

          {tab === 'services' ? <ServicesTab {...props} /> : tab === 'extensions' ? <ExtensionsTab {...props} /> : <SkillsTab {...props} />}
        </div>
      </div>
    </>
  )
}
