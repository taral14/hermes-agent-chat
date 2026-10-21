import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

// db.ts відкриває базу в DATA_DIR під час імпорту: лише тимчасова тека, ніколи не справжні дані.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chat-test-'))
const { createChat, getChat, insertMessage, markRead, unreadTotal } = await import('../server/db.ts')
import type { MessageRow } from '../server/db.ts'

const reply = (chatId: string, at: number, role: 'user' | 'assistant' = 'assistant', status: MessageRow['status'] = 'done'): MessageRow => ({
  id: `${chatId}-${at}-${role}`,
  chatId,
  role,
  text: 'привіт',
  attachments: [],
  parts: [],
  status,
  error: null,
  usage: null,
  model: null,
  createdAt: at,
  finishedAt: status === 'done' ? at : null,
  runId: null,
  lastSeq: -1,
})

describe('непрочитане', () => {
  test('відповіді Hermes після останнього перегляду — непрочитані, свої й незавершені — ні', () => {
    createChat('a', '', null)
    const now = Date.now()
    // Перше повідомлення від Hermes у щойно створеному чаті (вхідні) — у ту ж мить.
    insertMessage(reply('a', getChat('a')!.createdAt))
    insertMessage(reply('a', now + 1, 'user'))
    insertMessage(reply('a', now + 2, 'assistant', 'running'))
    assert.equal(getChat('a')!.unread, 1)
    assert.equal(markRead('a'), true)
    assert.equal(getChat('a')!.unread, 0)
    assert.equal(markRead('a'), false)
    insertMessage(reply('a', Date.now() + 10))
    assert.equal(getChat('a')!.unread, 1)
  })

  test('значок рахує всі чати, крім тих, що без сповіщень', () => {
    createChat('b', '', null)
    insertMessage(reply('b', Date.now() + 10))
    assert.equal(unreadTotal(), 2)
    assert.equal(unreadTotal(['b']), 1)
  })
})
