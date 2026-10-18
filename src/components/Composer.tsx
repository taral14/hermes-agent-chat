import { ArrowUp, FileText, Loader2, MessageSquarePlus, Paperclip, Square, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { api, uploadUrl } from '../api.ts'
import type { Attachment } from '../shared.ts'

type Pending = { key: string; name: string; mime: string; preview?: string; att?: Attachment; error?: string }

export type ComposerHandle = { addFiles: (files: FileList | File[]) => void; focus: () => void }

type Props = {
  ref?: Ref<ComposerHandle>
  running: boolean
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onStop: () => void
  onSteer: (text: string) => Promise<boolean>
  draftKey: string
}

const drafts = new Map<string, string>()

export function Composer({ ref, running, onSend, onStop, onSteer, draftKey }: Props) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [files, setFiles] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(drafts.get(draftKey) ?? '')
    setFiles([])
    area.current?.focus()
  }, [draftKey])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const addFiles = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const key = Math.random().toString(36).slice(2)
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      setFiles((f) => [...f, { key, name: file.name || 'image.png', mime: file.type, preview }])
      const named = file.name ? file : new File([file], `image-${Date.now()}.png`, { type: file.type })
      api
        .upload(named)
        .then((att) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, att } : x))))
        .catch((e: Error) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, error: e.message } : x))))
    }
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => area.current?.focus() }))

  const uploading = files.some((f) => !f.att && !f.error)
  const ready = files.filter((f) => f.att).map((f) => f.att!)
  const canSend = !busy && !uploading && (text.trim().length > 0 || (!running && ready.length > 0))

  const submit = async () => {
    if (!canSend) return
    setBusy(true)
    const ok = running ? await onSteer(text.trim()) : await onSend(text.trim(), ready)
    setBusy(false)
    if (ok) {
      setText('')
      drafts.delete(draftKey)
      if (!running) setFiles([])
    }
    area.current?.focus()
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f) => (
              <div key={f.key} className={`chip ${f.error ? 'is-error' : ''}`} title={f.error ?? f.name}>
                {f.preview || (f.att && f.mime.startsWith('image/')) ? (
                  <img src={f.preview ?? uploadUrl(f.att!.id)} alt="" />
                ) : (
                  <span className="chip-icon">
                    <FileText size={18} />
                  </span>
                )}
                {!f.mime.startsWith('image/') && <span className="chip-name">{f.name}</span>}
                {!f.att && !f.error && (
                  <span className="chip-loading">
                    <Loader2 size={16} className="spin" />
                  </span>
                )}
                <button type="button" className="chip-x" aria-label="Прибрати" onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={running ? 'Додати до поточної задачі…' : 'Напиши Hermes'}
          onChange={(e) => {
            setText(e.target.value)
            drafts.set(draftKey, e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={(e) => {
            const list = Array.from(e.clipboardData.files)
            if (list.length) {
              e.preventDefault()
              addFiles(list)
            }
          }}
        />
        <div className="composer-bar">
          <button type="button" className="icon-btn round" title="Прикріпити файл" aria-label="Прикріпити файл" onClick={() => picker.current?.click()}>
            <Paperclip size={18} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="composer-spacer" />
          {running && text.trim() ? (
            <button type="button" className="send-btn" title="Додати до поточної задачі" aria-label="Додати до задачі" disabled={!canSend} onClick={() => void submit()}>
              <MessageSquarePlus size={18} />
            </button>
          ) : running ? (
            <button type="button" className="send-btn" title="Зупинити" aria-label="Зупинити" onClick={onStop}>
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="send-btn" title="Надіслати" aria-label="Надіслати" disabled={!canSend} onClick={() => void submit()}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">Hermes виконує дії на Mac mini. Перевіряй важливе.</div>
    </div>
  )
}
