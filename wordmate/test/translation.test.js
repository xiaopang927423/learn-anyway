const { test } = require('node:test')
const assert = require('node:assert/strict')
const ai = require('../src/ai')
test('Diffu chat completions uses temperature zero and parses thinking output', async () => {
  const original = global.fetch
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost/v1/chat/completions')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'diffu')
    assert.equal(body.temperature, 0)
    assert.ok(options.signal)
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>{reasoning}</think>```json\n{"type":"sentence","translation":"你好","examples":null}\n```' } }] }) }
  }
  try {
    const result = await ai.translate('Hello there!', '', { baseUrl: 'http://localhost/v1/', model: 'diffu', apiKey: 'test' })
    assert.equal(result.translation, '你好')
    assert.deepEqual(result.examples, [])
  } finally { global.fetch = original }
})
test('malformed translation is rejected', async () => {
  const original = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"type":"sentence","translation":{}}' } }] }) })
  try { await assert.rejects(ai.translate('Hello', '', {}), /translation/) }
  finally { global.fetch = original }
})
test('cache varies by context and model and autoAdd=false is respected', async () => {
  const dbPath = require.resolve('../src/db')
  const dictPath = require.resolve('../src/dict')
  const cache = new Map()
  let adds = 0, calls = 0
  const settings = { apiKey: 'test', model: 'diffu', autoAdd: false }
  require.cache[dbPath] = { exports: { hasWord: () => false, getSettings: () => settings, getCache: k => cache.get(k), saveCache: (k,v) => cache.set(k, JSON.stringify(v)), addWord: () => adds++ } }
  require.cache[dictPath] = { exports: { lookup: async () => null } }
  const original = ai.translate
  ai.translate = async () => { calls++; return { type: 'word', word: 'bank', definitions: [{meaning:'银行'}] } }
  const translator = require('../src/translator')
  try {
    await translator.lookup('bank', 'river bank')
    assert.equal((await translator.lookup('bank', 'river bank')).cached, true)
    await translator.lookup('bank', 'deposit money')
    settings.model = 'qwen-turbo'
    await translator.lookup('bank', 'deposit money')
    assert.equal(calls, 3)
    assert.equal(adds, 0)
    assert.match((await translator.lookup('x'.repeat(12001))).error, /过长/)
  } finally { ai.translate = original; delete require.cache[dbPath]; delete require.cache[dictPath] }
})
