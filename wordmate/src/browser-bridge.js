// 仅在本机用户可读写的 Unix socket 上返回翻译，不向扩展暴露模型密钥。
const net = require('net'), fs = require('fs'), path = require('path')
const ai = require('./ai'), db = require('./db'), translator = require('./translator')
function startBrowserBridge(userData, onChanged = () => {}) {
  const socketPath = path.join(userData, 'browser.sock')
  try { fs.unlinkSync(socketPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  let active = 0
  const server = net.createServer(socket => {
    socket.setEncoding('utf8')
    let buffer = '', handled = false
    socket.setTimeout(60000, () => socket.destroy())
    const reply = value => { if (!socket.destroyed) socket.end(JSON.stringify(value) + '\n') }
    socket.on('error', () => {})
    socket.on('data', async chunk => {
      if (handled) return
      buffer += chunk.toString('utf8')
      if (Buffer.byteLength(buffer) > 100000) { handled = true; reply({ ok: false, error: '请求过长' }); return }
      if (!buffer.includes('\n')) return
      handled = true
      if (active >= 4) { reply({ ok: false, error: '翻译请求较多，请稍后重试' }); return }
      active++
      try {
        const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (!['selection', 'page'].includes(message.action)) throw new Error('不支持的浏览器操作')
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 12000) throw new Error('文本须为 1–12000 字符')
        if (message.context != null && (typeof message.context !== 'string' || message.context.length > 4000)) throw new Error('上下文过长')
        const result = message.action === 'selection'
          ? await translator.lookup(message.text, message.context || '')
          : await translatePageBlock(message.text, message.target)
        if (result.error) throw new Error(result.error)
        if (message.action === 'selection') onChanged('lookup')
        reply({ ok: true, result })
      } catch (error) { reply({ ok: false, error: error.message }) }
      finally { active-- }
    })
  })
  server.on('error', error => console.error('[WordMate] 浏览器连接启动失败:', error.message))
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600))
  return server
}
async function translatePageBlock(text, target = 'zh') {
  if (!['zh', 'en'].includes(target)) throw new Error('目标语言不支持')
  const settings = db.getSettings()
  if (!settings.apiKey) throw new Error('请先在 WordMate 设置中配置模型')
  const key = 'page:' + require('crypto').createHash('sha256')
    .update(JSON.stringify([text, target, settings.baseUrl, settings.model])).digest('hex')
  const cached = db.getCache(key)
  if (cached) { try { return { ...JSON.parse(cached), cached: true } } catch {} }
  const result = await ai.translatePassage(text, target, settings)
  db.saveCache(key, result)
  return result
}
module.exports = { startBrowserBridge, translatePageBlock }
