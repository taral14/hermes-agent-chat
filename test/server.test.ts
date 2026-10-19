import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { describe, test } from 'node:test'
import { clientIp, sameOrigin } from '../server/http.ts'

const req = (remote: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress: remote }, headers }) as unknown as IncomingMessage

describe('адреса клієнта', () => {
  test('заголовкам проксі віримо лише з цього комп’ютера', () => {
    assert.equal(clientIp(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.5' })), '203.0.113.5')
    assert.equal(clientIp(req('::1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '198.51.100.7')
    assert.equal(clientIp(req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9')
  })
})

describe('захист від чужих сторінок (CSRF)', () => {
  test('той самий сайт — так, чужий — ні', () => {
    assert.equal(sameOrigin(req('127.0.0.1', { host: 'chat.example.com', origin: 'https://chat.example.com', 'sec-fetch-site': 'same-origin' })), true)
    assert.equal(sameOrigin(req('127.0.0.1', { host: 'chat.example.com', origin: 'https://evil.example.com' })), false)
    assert.equal(sameOrigin(req('127.0.0.1', { host: 'chat.example.com', 'sec-fetch-site': 'same-site' })), false)
    assert.equal(sameOrigin(req('127.0.0.1', { host: 'chat.example.com' })), true)
  })
})
