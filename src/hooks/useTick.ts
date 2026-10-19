import { useEffect, useState } from 'react'

/** Поточний час, що оновлюється раз на ms: для «через 5 хв», «вчора о 10:00». */
export function useTick(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
