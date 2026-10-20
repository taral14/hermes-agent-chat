import { Eye, Loader2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'
import type { LinkPreview, Message, SharedChat } from '../shared.ts'
import { FileViewerHost } from './FileViewer.tsx'
import { PreviewContext } from './Links.tsx'
import { MessageView, TimeSeparator, needsTimeSeparator } from './MessageView.tsx'

const dateFmt = new Intl.DateTimeFormat('uk', { day: 'numeric', month: 'long', year: 'numeric' })

/** Сторінка спільного чату (/s/<токен>): без входу, лише перегляд. */
export function ShareView({ token }: { token: string }) {
  const [data, setData] = useState<SharedChat | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api
      .publicShare(token)
      .then((d) => {
        setData(d)
        document.title = `${d.title} · Hermes`
      })
      .catch((e: Error) => setErr(e.message))
  }, [token])

  // Картки посилань беремо зі знімка: глядач не змушує сервер ходити в мережу.
  const resolve = useMemo(
    () => (url: string) => Promise.resolve<LinkPreview>(data?.previews[url] ?? { url, kind: 'link', failed: true }),
    [data],
  )
  const messages: Message[] = useMemo(
    () =>
      (data?.messages ?? []).map((m) => ({
        ...m,
        chatId: '',
        parts: [],
        status: 'done',
        error: null,
        usage: null,
        finishedAt: m.createdAt,
      })),
    [data],
  )

  return (
    <div className="share-page">
      <FileViewerHost />
      <header className="share-top">
        <a className="share-brand" href="/">
          <img src="/favicon.svg" alt="" />
          Hermes
        </a>
        <span className="share-badge">
          <Eye size={14} />
          Лише перегляд
        </span>
      </header>
      {err ? (
        <div className="share-empty">
          <h1>Посилання не працює</h1>
          <p>{err}</p>
        </div>
      ) : !data ? (
        <div className="share-empty">
          <Loader2 size={24} className="spin" />
        </div>
      ) : (
        <div className="thread share-thread">
          <div className="thread-inner">
            <div className="share-head">
              <h1>{data.title}</h1>
              <div className="share-meta">Знімок розмови від {dateFmt.format(data.sharedAt)}</div>
            </div>
            <PreviewContext.Provider value={resolve}>
              {messages.map((m, i) => (
                <Fragment key={m.id}>
                  {needsTimeSeparator(messages[i - 1], m) && <TimeSeparator at={m.createdAt} />}
                  <MessageView m={m} />
                </Fragment>
              ))}
            </PreviewContext.Provider>
            <div className="share-foot">Це копія розмови з Hermes лише для читання. Відповісти чи продовжити її тут не можна.</div>
          </div>
        </div>
      )}
    </div>
  )
}
