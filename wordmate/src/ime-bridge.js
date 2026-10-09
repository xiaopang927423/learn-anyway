const net = require('net'), fs = require('fs'), path = require('path'), crypto = require('crypto')
const { ImeTranslationService } = require('./ime-translation')
const { commitLearning } = require('./ime-learning')
const MAX_FRAME = 65536
function frame(data) { const body = Buffer.from(JSON.stringify(data)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]) }
function preferences(settings) {
  const relevant = [settings.imeEnabled, settings.imeAutoAdd, settings.imeSaveContext, settings.thinkingEnabled, settings.thinkingParameter, settings.model, settings.baseUrl]
  return { revision: parseInt(crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex').slice(0, 12), 16), learningLanguage: 'en', enabled: settings.imeEnabled, autoAdd: settings.autoAdd && settings.imeAutoAdd, saveContext: settings.imeSaveContext, thinkingEnabled: settings.thinkingEnabled, model: settings.model }
}
async function startImeBridge(userData, db, changed = () => {}) {
  const socketPath = path.join(userData, 'ime.sock')
  fs.mkdirSync(userData, { recursive: true })
  const tokenPath = path.join(userData, 'ime-token')
  let token
  try { token = fs.readFileSync(tokenPath, 'utf8').trim(); if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid') }
  catch { token = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(tokenPath, token, { mode: 0o600 }) }
  fs.chmodSync(tokenPath, 0o600)
  if (fs.existsSync(socketPath)) {
    const alive = await new Promise(resolve => {
      const c = net.connect(socketPath); c.setTimeout(500)
      c.once('connect', () => { c.destroy(); resolve(true) }); c.once('error', () => resolve(false)); c.once('timeout', () => { c.destroy(); resolve(true) })
    })
    if (alive) throw new Error('IME_SOCKET_IN_USE')
    fs.unlinkSync(socketPath)
  }
  const instance = crypto.randomUUID(), clients = new Set()
  const service = new ImeTranslationService({ settings: () => db.getSettings() })
  let active = 0
  const server = net.createServer(socket => {
    if (clients.size >= 8) { socket.destroy(); return }
    clients.add(socket)
    let buffer = Buffer.alloc(0), authorized = false, busy = 0
    const pending = new Map()
    socket.setTimeout(60000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('close', () => { clients.delete(socket); for (const c of pending.values()) c.abort() })
    const send = value => { if (!socket.destroyed) socket.write(frame(value)) }
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_FRAME * 2) { socket.destroy(); return }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0)
        if (!size || size > MAX_FRAME) { socket.destroy(); return }
        if (buffer.length < size + 4) break
        let message
        try { message = JSON.parse(buffer.subarray(4, size + 4).toString('utf8')) } catch { socket.destroy(); return }
        buffer = buffer.subarray(size + 4)
        const requestId = message.requestId
        if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) { socket.destroy(); return }
        if (pending.has(requestId)) { send({ requestId, ok: false, error: { code: 'INVALID_INPUT', message: '重复请求编号' } }); continue }
        if (busy >= 4 || active >= 16) { send({ requestId, ok: false, error: { code: 'BUSY', message: '请求较多' } }); continue }
        busy++; active++
        const controller = new AbortController(); pending.set(requestId, controller)
        Promise.resolve().then(async () => {
          if (message.protocolVersion !== 1) throw Object.assign(new Error('协议版本不兼容'), { code: 'UNSUPPORTED_VERSION' })
          const p = message.payload || {}
          if (message.method === 'hello') {
            const supplied = typeof p.authToken === 'string' ? Buffer.from(p.authToken) : Buffer.alloc(0)
            const expected = Buffer.from(token)
            if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw Object.assign(new Error('未授权连接'), { code: 'UNAUTHORIZED' })
            authorized = true
            return { serverInstanceId: instance, capabilities: ['preview.fragment', 'preview.selection', 'learning.commit', 'preferences.get', 'prediction.query'], protocolVersion: 1 }
          }
          if (!authorized) throw Object.assign(new Error('请先完成握手'), { code: 'UNAUTHORIZED' })
          switch (message.method) {
            case 'preferences.get': return preferences(db.getSettings())
            case 'health': return { serverInstanceId: instance, status: 'ready' }
            case 'preview.fragment': return service.preview(p, false, controller.signal)
            case 'preview.selection': return service.preview(p, true, controller.signal)
            case 'prediction.query': {
              const settings = db.getSettings()
              if (!settings.imeEnabled || !settings.apiKey) throw Object.assign(new Error('请开启 WordMate 云辅助'), {code:'NOT_CONFIGURED'})
              if (!['compose','question'].includes(p.kind) || ['before','after','pinyin','guess'].some(k=>typeof p[k]!=='string' || [...p[k]].length>200) || !Array.isArray(p.candidates) || p.candidates.length>20 || p.candidates.some(s=>typeof s!=='string'||s.length>200)) throw Object.assign(new Error('联想数据无效'),{code:'INVALID_INPUT'})
              const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])
              return require('./model-request-queue').modelQueue.run('ime',()=>require('./ai').predictIme(p,settings,signal),{signal,deadline:Date.now()+5000})
            }
            case 'learning.commit': return commitLearning(p, db, changed)
            case 'request.cancel': pending.get(p.requestId)?.abort(); return { canceled: true }
            default: throw Object.assign(new Error('不支持的输入法操作'), { code: 'INVALID_INPUT' })
          }
        }).then(result => send({ requestId, ok: true, result }), error => send({ requestId, ok: false, error: { code: error.code || 'SERVICE_UNAVAILABLE', message: ['INVALID_INPUT', 'NOT_CONFIGURED', 'BUSY', 'UNSUPPORTED_VERSION', 'UNAUTHORIZED'].includes(error.code) ? error.message : '输入辅助暂不可用，请继续普通输入' } }))
          .finally(() => { busy--; active--; pending.delete(requestId) })
      }
    })
  })
  server.dispose = callback => { for (const c of clients) c.destroy(); service.clear(); server.close(callback) }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { fs.chmodSync(socketPath, 0o600); resolve() }) })
  return server
}
module.exports = { startImeBridge, frame, preferences, MAX_FRAME }
