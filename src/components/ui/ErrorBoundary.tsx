// Помилка рендеру в одній частині (кривий Markdown, незнайомий тип події) не має гасити весь застосунок.
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: (reset: () => void) => ReactNode }

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui]', error, info.componentStack)
  }

  reset = () => this.setState({ failed: false })

  render() {
    if (!this.state.failed) return this.props.children
    return (
      this.props.fallback?.(this.reset) ?? (
        <div className="ui-error" role="alert">
          <p>Щось пішло не так під час показу сторінки.</p>
          <button type="button" className="btn" onClick={() => location.reload()}>
            Перезавантажити
          </button>
        </div>
      )
    )
  }
}

/** Повідомлення, яке не вдалося показати: решта розмови лишається. */
export function MessageFallback() {
  return <div className="msg-error ui-msg-error">Це повідомлення не вдалося показати.</div>
}
