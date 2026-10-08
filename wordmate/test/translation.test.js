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
    settings.thinkingEnabled = true
    await translator.lookup('bank', 'deposit money')
    assert.equal(calls, 4)
    assert.equal(adds, 0)
    assert.match((await translator.lookup('x'.repeat(12001))).error, /过长/)
  } finally { ai.translate = original; delete require.cache[dbPath]; delete require.cache[dictPath] }
})

test('Thinking switch is passed to dictionary, connectivity and webpage requests', async () => {
  const original = global.fetch
  const requests = []
  global.fetch = async (url,options) => {
    requests.push(JSON.parse(options.body))
    return {ok:true,json:async()=>({choices:[{message:{content:'{"type":"sentence","translation":"你好"}'}}]})}
  }
  const settings={baseUrl:'http://localhost/v1',model:'diffu',apiKey:'test',thinkingEnabled:false}
  try {
    await ai.translate('Hello!', '', settings)
    await ai.ping(settings)
    await ai.translatePassage('Hello!', 'zh', settings)
    assert.ok(requests.every(body=>body.chat_template_kwargs.enable_thinking===false))
    settings.thinkingEnabled=true
    await ai.translatePassage('Hello!', 'zh', settings)
    assert.equal(requests.at(-1).chat_template_kwargs.enable_thinking,true)
    assert.deepEqual(ai.thinkingOptions({...settings,baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',thinkingEnabled:false}),{enable_thinking:false})
    assert.deepEqual(ai.thinkingOptions({...settings,model:'other',thinkingParameter:'none'}),{})
  } finally {global.fetch=original}
})
test('layout fragment translations are validated before replacing page text', async () => {
  const original=global.fetch
  const settings={baseUrl:'http://localhost/v1',model:'diffu',apiKey:'test'}
  global.fetch=async(url,options)=>{
    const request=JSON.parse(options.body)
    assert.deepEqual(JSON.parse(request.messages[1].content).fragments,[{id:0,text:'Please '},{id:1,text:'check'}])
    return {ok:true,json:async()=>({choices:[{message:{content:'{"translation":"请查看","segments":{"1":"查看","0":"请"}}'}}]})}
  }
  try {
    const result=await ai.translatePassage('Please check','zh',settings,['Please ','check'])
    assert.deepEqual(result.segments,['请','查看'])
    global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"translation":"请查看","segments":["缺失片段"]}'}}]})})
    await assert.rejects(ai.translatePassage('Please check','zh',settings,['Please ','check']),/排版/)
  }finally{global.fetch=original}
})
