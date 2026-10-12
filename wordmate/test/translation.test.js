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

test('segments-only response provides valid translation without redundant translation field',async()=>{
 const original=global.fetch
 global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:[{type:'text',text:'```json\n{"segments":{"0":"请","1":"查看"}}\n```'}]}}]})})
 try{const result=await ai.translatePassage('Please check','zh',{model:'diffu'},['Please ','check']);assert.equal(result.translation,'请查看');assert.deepEqual(result.segments,['请','查看'])}finally{global.fetch=original}
})
test('empty final answer is retried once without reading reasoning as translation',async()=>{
 const original=global.fetch;let calls=0;let signal
 global.fetch=async(url,options)=>{calls++;if(signal)assert.equal(options.signal,signal);signal=options.signal
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:calls===1?{content:'',reasoning_content:'内部分析'}:{content:'{"translation":"你好"}'}}]})}}
 try{const result=await ai.translatePassage('Hello','zh',{model:'diffu'});assert.equal(result.translation,'你好');assert.equal(result.recovered,true);assert.equal(calls,2)}finally{global.fetch=original}
})
test('truncated model output fails after a bounded retry with useful diagnosis',async()=>{
 const original=global.fetch;let calls=0
 global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"translation":"未完成'}}]})}}
 try{await assert.rejects(ai.translatePassage('Hello','zh',{}),/截断/);assert.equal(calls,2)}finally{global.fetch=original}
})
test('multiple JSON objects and tool-call responses are parsed without greedy merging',async()=>{
 const original=global.fetch
 global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'说明 {"metadata":"ignored"}\n{"translation":"完成 {任务}"}'}}]})})
 try{assert.equal((await ai.translatePassage('Done','zh',{})).translation,'完成 {任务}');global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[{function:{arguments:'{"translation":"完成"}'}}]}}]})});assert.equal((await ai.translatePassage('Done','zh',{})).translation,'完成')}finally{global.fetch=original}
})
test('authorization failures and explicit model refusals are not retried',async()=>{
 const original=global.fetch;let calls=0
 global.fetch=async()=>{calls++;return {ok:false,status:401}}
 try{await assert.rejects(ai.translatePassage('Hello','zh',{}),/401/);assert.equal(calls,1);calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{refusal:'declined'}}]})}};await assert.rejects(ai.translatePassage('Hello','zh',{}),/拒绝/);assert.equal(calls,1)}finally{global.fetch=original}
})
test('unclosed thinking blocks are not mistaken for a final JSON answer',async()=>{
 const original=global.fetch;let calls=0
 global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'<think>这是草稿 {"translation":"不能使用"}'}}]})}}
 try{await assert.rejects(ai.translatePassage('Hello','zh',{}),/格式异常/);assert.equal(calls,2)}finally{global.fetch=original}
})

test('English cloud completion validates prefixes, removes duplicates and never returns a sentence', async () => {
 const original=global.fetch
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body)
  assert.match(body.messages[0].content,/英文输入法/)
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({words:[{text:'developer',syllables:[]},{text:'Developer',syllables:[]},{text:'development',syllables:[]},{text:'unrelated',syllables:[]},{text:'deve bad',syllables:[]}],sentence:'do not replace the sentence'})}}]})}
 }
 try {
  const result=await ai.predictIme({kind:'english',pinyin:'deve',wantSentence:true,maxItems:1},{apiKey:'fixture',model:'diffu'},new AbortController().signal)
  assert.deepEqual(result,{words:[{text:'developer',syllables:[]}],sentence:null})
 }finally{global.fetch=original}
})
