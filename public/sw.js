// Service worker чату: лише пуші й кліки по сповіщеннях. Сторінки не кешує.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let p = {}
  try {
    p = event.data ? event.data.json() : {}
  } catch {
    p = { title: 'Hermes', body: event.data ? event.data.text() : '' }
  }
  const options = {
    body: p.body || '',
    tag: p.tag,
    renotify: Boolean(p.tag),
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    requireInteraction: Boolean(p.requireInteraction),
    actions: p.actions || [],
    data: { url: p.url || '/', ...p.data },
  }
  event.waitUntil(self.registration.showNotification(p.title || 'Hermes', options))
})

async function openUrl(url) {
  const target = new URL(url, self.location.origin).href
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const w of wins) {
    if (new URL(w.url).origin !== self.location.origin) continue
    await w.focus()
    if (w.url !== target) w.postMessage({ type: 'navigate', url })
    return
  }
  await self.clients.openWindow(target)
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification
  const d = n.data || {}
  n.close()
  event.waitUntil(
    (async () => {
      // «Дозволити» / «Відхилити» прямо зі сповіщення (на Mac і Android; iPhone кнопок не показує).
      if (event.action && d.messageId && d.promptId) {
        try {
          const res = await fetch(`/api/messages/${d.messageId}/approval`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptId: d.promptId, generation: d.generation, value: event.action }),
          })
          if (res.ok) return
        } catch {
          /* відкриємо чат нижче */
        }
      }
      await openUrl(d.url || '/')
    })(),
  )
})
