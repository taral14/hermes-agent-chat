// Форма задачі за розкладом: спільна для сторінки задачі й шторки в чаті.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { type Draft, draftValid, fromDraft, toDraft } from '../schedule.ts'
import type { Job } from '../shared.ts'

export type JobForm = { name: string; prompt: string; draft: Draft; deliver: string; repeat: number | null }

export function formOf(job: Job | null): JobForm {
  return {
    name: job?.name ?? '',
    prompt: job?.prompt ?? '',
    draft: toDraft(job?.schedule),
    deliver: job?.deliver ?? 'webchat:new',
    repeat: job?.repeat.times ?? null,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type Options = {
  flash: (e: unknown) => void
  /** Задачу не вдалося завантажити (видалена чи немає зв'язку з Hermes). */
  onMissing: () => void
}

/**
 * Задача й форма її редагування. Поки сторінка відкрита, задача сама оновлюється (наступний запуск, стан),
 * а форма — лише якщо людина нічого не змінювала.
 */
export function useJobForm(id: string | null, { flash, onMissing }: Options) {
  const [job, setJob] = useState<Job | null>(null)
  const [form, setForm] = useState<JobForm>(() => formOf(null))
  const [saved, setSaved] = useState<JobForm>(() => formOf(null))
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const opts = useRef({ flash, onMissing })
  opts.current = { flash, onMissing }
  const dirtyRef = useRef(false)

  const dirty = !same(form, saved)
  dirtyRef.current = dirty

  const adopt = useCallback((j: Job, keepForm = false) => {
    setJob(j)
    if (keepForm) return
    setForm(formOf(j))
    setSaved(formOf(j))
  }, [])

  useEffect(() => {
    if (!id) return
    let alive = true
    api
      .job(id)
      .then((j) => alive && adopt(j))
      .catch((e) => {
        if (!alive) return
        opts.current.flash(e)
        opts.current.onMissing()
      })
    const t = setInterval(() => {
      api
        .job(id)
        .then((j) => alive && adopt(j, dirtyRef.current))
        .catch(() => {})
    }, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id, adopt])

  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  const show = useCallback((text: string, ms = 2500) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), ms)
  }, [])

  const run = async <T>(kind: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(kind)
    try {
      return await fn()
    } catch (e) {
      opts.current.flash(e)
      return null
    } finally {
      setBusy('')
    }
  }

  // Розклад перевіряємо, лише якщо його змінили: давно виконану одноразову задачу можна перейменувати.
  const draftChanged = !job || !same(form.draft, saved.draft)
  const invalid = !form.name.trim()
    ? 'Дай задачі назву'
    : !form.prompt.trim() && !job?.no_agent
      ? 'Опиши, що зробити'
      : draftChanged
        ? draftValid(form.draft)
        : ''

  /** Створити (нова) або зберегти змінене. Повертає задачу після збереження. */
  const save = () =>
    run('save', async () => {
      if (invalid) return null
      const body = { name: form.name.trim(), prompt: form.prompt.trim(), schedule: fromDraft(form.draft), deliver: form.deliver, repeat: form.repeat }
      if (!job) return api.createJob({ ...body, repeat: body.repeat ?? undefined })
      const patch: Record<string, unknown> = {}
      if (form.name !== saved.name) patch.name = body.name
      if (form.prompt !== saved.prompt) patch.prompt = body.prompt
      if (draftChanged) patch.schedule = body.schedule
      if (form.deliver !== saved.deliver) patch.deliver = body.deliver
      if (form.repeat !== saved.repeat) patch.repeat = body.repeat
      const updated = await api.updateJob(job.id, patch)
      adopt(updated)
      show('Збережено', 2000)
      return updated
    })

  const act = (action: 'pause' | 'resume' | 'run') =>
    run(action, async () => {
      if (!job) return null
      const updated = await api.jobAction(job.id, action)
      adopt({ ...job, ...updated }, true)
      return updated
    })

  const remove = () =>
    run('delete', async () => {
      if (!job) return false
      await api.deleteJob(job.id)
      return true
    })

  return { job, form, setForm, saved, reset: () => setForm(saved), dirty, invalid, busy, notice, show, run, save, act, remove }
}
