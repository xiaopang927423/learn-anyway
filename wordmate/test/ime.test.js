const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { ModelRequestQueue } = require('../src/model-request-queue')
const { ImeTranslationService } = require('../src/ime-translation')
const { validateCommit } = require('../src/ime-learning')
const { startImeBridge, frame, preferences, MAX_FRAME } = require('../src/ime-bridge')
const ai = require('../src/ai')
const identity = { sessionId:'session-test', fragmentId:'active', clientGeneration:1, revision:2, settingsRevision:1 }
const payload = { sourceText:'早饭', target:'en', contextBefore:'we want to eat ', contextAfter:'', identity }
test('IME preview cache returns current identity without learning or disk writes', async () => {
  let calls = 0
  const settings = { imeEnabled:true, apiKey:'test', model:'diffu' }
  const service = new ImeTranslationService({ settings:()=>settings, translate:async p=>{calls++; return {candidates:[{text:'breakfast',meaning:p.sourceText}]}} })
  assert.equal((await service.preview(payload)).candidates[0].text,'breakfast')
  const current = {...payload,identity:{...identity,revision:9}}
  assert.equal((await service.preview(current)).identity.revision,9)
  assert.equal(calls,1)
  settings.thinkingEnabled=true
  await service.preview(payload); assert.equal(calls,2)
  settings.imeEnabled=false
  await assert.rejects(service.preview(payload),e=>e.code==='NOT_CONFIGURED')
  await assert.rejects(service.preview({...payload,sourceText:'a'.repeat(101)}),e=>e.code==='INVALID_INPUT')
  await assert.rejects(service.preview({...payload,private:true}),e=>e.code==='INVALID_INPUT')
})
test('Pending mixed sentence keeps its exact English prefix while translating the Chinese tail', async () => {
  const original=global.fetch
  let request
  global.fetch=async (_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'{"candidates":[{"text":"breakfast","meaning":"早餐"}]}'}}]})}}
  try {
    const result=await ai.translateIme({...payload,sourceText:'I want to eat 早餐',contextBefore:''},{model:'diffu',apiKey:'test'},AbortSignal.timeout(1000),true)
    assert.equal(result.candidates[0].text,'I want to eat breakfast')
    assert.equal(JSON.parse(request.messages[1].content).sourceText,'早餐')
    assert.equal(JSON.parse(request.messages[1].content).contextBefore,'I want to eat ')
  } finally {global.fetch=original}
})
test('English fragment prompt keeps prior grammar and disables Thinking', async () => {
  const original=global.fetch
  let request
  global.fetch=async (url,options)=>{request=JSON.parse(options.body); return {ok:true,json:async()=>({choices:[{message:{content:'{"candidates":[{"text":"breakfast","meaning":"早餐"}]}'}}]})}}
  try {
    const result=await ai.translateIme(payload,{model:'diffu',baseUrl:'http://localhost/v1',apiKey:'test'},AbortSignal.timeout(1000))
    assert.equal(result.candidates[0].text,'breakfast')
    assert.equal(request.chat_template_kwargs.enable_thinking,false)
    assert.match(request.messages[0].content,/不能 have breakfast/)
    assert.equal(JSON.parse(request.messages[1].content).contextBefore,'we want to eat ')
  } finally {global.fetch=original}
})
test('Malformed and non-English model output is rejected within bounded retries', async () => {
  const original=global.fetch;let calls=0
  global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'{"candidates":[{"text":"<script>你好</script>","meaning":"早餐"}]}'}}]})}}
  try {await assert.rejects(ai.translateIme(payload,{},AbortSignal.timeout(1000)),e=>e.code==='MODEL_FORMAT');assert.equal(calls,2)} finally {global.fetch=original}
})
test('Learning rejects unconfirmed, invalid or private events and has a stable digest', () => {
  const event={commitId:'commit-test-001',confirmed:true,adoptedExpression:'as soon as possible',sourceMeaning:'尽快',origin:'fragment'}
  assert.equal(validateCommit(event).expression,'as soon as possible')
  assert.equal(validateCommit(event).digest,validateCommit({...event}).digest)
  for (const patch of [{confirmed:false},{adoptedExpression:'早饭'},{origin:'preview'},{private:true},{context:'a'.repeat(201)},{manual:true}]) assert.throws(()=>validateCommit({...event,...patch}))
})
test('Model queue reserves input capacity while two page tasks are running', async () => {
  const queue=new ModelRequestQueue();let release1,release2
  const one=queue.run('page',()=>new Promise(r=>{release1=r}))
  const two=queue.run('page',()=>new Promise(r=>{release2=r}))
  await new Promise(r=>setImmediate(r))
  let page3=false
  const three=queue.run('page',()=>{page3=true})
  assert.equal(await queue.run('ime',()=>42),42)
  assert.equal(page3,false)
  release1();release2();await Promise.all([one,two,three]);assert.equal(page3,true)
})
test('A canceled queued preview never starts', async () => {
  const queue=new ModelRequestQueue(1);let release
  const first=queue.run('ime',()=>new Promise(r=>{release=r}))
  await new Promise(r=>setImmediate(r))
  const control=new AbortController();let ran=false
  const pending=queue.run('ime',()=>{ran=true},{signal:control.signal})
  control.abort();await assert.rejects(pending);release();await first;assert.equal(ran,false)
})
function connection(socketPath) {
  const socket=net.connect(socketPath);let buffer=Buffer.alloc(0)
  const waiters=new Map()
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE();if(buffer.length<size+4)break;const data=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);waiters.get(data.requestId)?.(data);waiters.delete(data.requestId)}})
  return {socket, request(method,payload={},parts=false){const requestId='request-'+Math.random().toString(16).slice(2);return new Promise(resolve=>{waiters.set(requestId,resolve);const data=frame({protocolVersion:1,requestId,method,payload});if(parts){socket.write(data.subarray(0,2));setImmediate(()=>socket.write(data.subarray(2)))}else socket.write(data)})}}
}
test('Socket protocol authenticates, handles partial frames and does not expose credentials', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wm-ime-'))
  const db={getSettings:()=>({imeEnabled:false,apiKey:'private-key',model:'diffu',autoAdd:true,imeAutoAdd:true}),commitImeLearning:()=>({saved:true,id:1})}
  const server=await startImeBridge(directory,db)
  const c=connection(path.join(directory,'ime.sock'))
  try {
    assert.equal((await c.request('health')).error.code,'UNAUTHORIZED')
    const token=fs.readFileSync(path.join(directory,'ime-token'),'utf8')
    assert.equal((await c.request('hello',{authToken:token},true)).ok,true)
    const result=await c.request('preferences.get')
    assert.equal(result.ok,true);assert.equal(result.result.learningLanguage,'en')
    assert.equal(JSON.stringify(result).includes('private-key'),false)
    assert.equal((await c.request('preview.fragment',payload)).error.code,'NOT_CONFIGURED')
    assert.equal(fs.statSync(path.join(directory,'ime.sock')).mode & 0o777,0o600)
    await assert.rejects(startImeBridge(directory,db),/IME_SOCKET_IN_USE/)
    const header=Buffer.alloc(4);header.writeUInt32LE(MAX_FRAME+1);c.socket.write(header)
    await new Promise(r=>c.socket.once('close',r))
  } finally {c.socket.destroy();await new Promise(r=>server.dispose(r));fs.rmSync(directory,{recursive:true,force:true})}
})
test('Preference fingerprint changes when model or privacy settings change',()=>{
  const a=preferences({imeEnabled:true,model:'diffu'}),b=preferences({imeEnabled:true,model:'other'})
  assert.notEqual(a.revision,b.revision)
})
