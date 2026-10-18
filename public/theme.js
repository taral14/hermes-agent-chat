// Тема й розмір тексту ще до першого кадру, щоб темна тема не блимала білим.
// Налаштування лежать у localStorage (кожен пристрій має свої); далі їх веде src/prefs.ts.
;(function () {
  var p = {}
  try {
    p = JSON.parse(localStorage.getItem('chat:prefs') || '{}') || {}
  } catch {
    p = {}
  }
  var dark = p.theme === 'dark' || (p.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.setAttribute('data-scheme', dark ? 'dark' : 'light')
  var scale = [0.9375, 1, 1.0625, 1.125, 1.1875][typeof p.textSize === 'number' ? p.textSize : 1] || 1
  root.style.setProperty('--text-scale', String(scale))
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#212121' : '#ffffff')
})()
