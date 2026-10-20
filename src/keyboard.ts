// iPhone відкриває клавіатуру лише на focus(), викликаний прямо в обробнику дотику. Новий чат ще треба
// намалювати, тож у дотику фокусуємо невидиме поле (клавіатура відкривається), а коли справжнє поле
// з'явиться, переводимо фокус на нього — клавіатура лишається відкритою. На комп'ютері це нічого не змінює.

/** Тримати клавіатуру, поки рендериться нове поле вводу; повертає функцію, що прибирає заглушку. */
export function holdKeyboard(): () => void {
  const el = document.createElement('input')
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  // 16px — щоб Safari не збільшував сторінку на фокусі.
  Object.assign(el.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', fontSize: '16px', pointerEvents: 'none' })
  document.body.appendChild(el)
  el.focus({ preventScroll: true })
  return () => el.remove()
}
