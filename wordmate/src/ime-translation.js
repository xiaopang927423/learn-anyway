const crypto = require('crypto')
const ai = require('./ai')
const { modelQueue } = require('./model-request-queue')
function fail(code, text) { throw Object.assign(new Error(text), { code }) }
function validatePreview(p, selection = false) {
  if (!p || typeof p !== 'object' || typeof p.sourceText !== 'string' || !p.sourceText.trim() || [...p.sourceText].length > (selection ? 1000 : 100)) fail('INVALID_INPUT', '片段长度无效')
  if (!['en', 'zh'].includes(p.target)) fail('INVALID_INPUT', '只支持中英目标')
  for (const [key, limit] of [['contextBefore', 120], ['contextAfter', 80]]) {
    if (p[key] != null && (typeof p[key] !== 'string' || [...p[key]].length > limit)) fail('INVALID_INPUT', '语境长度无效')
  }
  const id = p.identity
  if (!id || typeof id.sessionId !== 'string' || !id.sessionId || id.sessionId.length > 80 || typeof id.fragmentId !== 'string' || !id.fragmentId || id.fragmentId.length > 80 || !['clientGeneration', 'revision', 'settingsRevision'].every(k => Number.isSafeInteger(id[k]) && id[k] >= 0)) fail('INVALID_INPUT', '输入会话无效')
  if (p.private === true || /(?:\bsk-[\w-]{12,}|-----BEGIN .*PRIVATE KEY-----)/.test(p.sourceText + (p.contextBefore || '') + (p.contextAfter || ''))) fail('INVALID_INPUT', '此内容不启用云辅助')
}
class ImeTranslationService {
  constructor({ settings, translate = ai.translateIme, queue = modelQueue, now = Date.now }) { this.settings = settings; this.translate = translate; this.queue = queue; this.now = now; this.cache = new Map() }
  async preview(p, selection = false, signal) {
    validatePreview(p, selection)
    const s = this.settings()
    if (!s.imeEnabled) fail('NOT_CONFIGURED', '请在 WordMate 设置开启输入法云辅助')
    if (!s.apiKey) fail('NOT_CONFIGURED', '请先配置 WordMate 模型')
    const key = crypto.createHash('sha256').update(JSON.stringify([p.sourceText, p.sourceCandidateId, p.target, p.contextBefore || '', p.contextAfter || '', s.baseUrl, s.model, s.thinkingEnabled, s.thinkingParameter, selection, 'ime-v1'])).digest('hex')
    const hit = this.cache.get(key)
    if (hit && hit.until > this.now()) return { ...hit.result, identity: p.identity, cached: true }
    const deadline = this.now() + 5000
    const timeout = AbortSignal.timeout(5000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const result = await this.queue.run('ime', () => this.translate(p, s, combined, selection), { signal: combined, deadline })
    const latest = this.settings()
    if (!latest.imeEnabled || ['apiKey','baseUrl','model','thinkingEnabled','thinkingParameter'].some(k=>latest[k]!==s[k])) fail('NOT_CONFIGURED','设置已变化，请重新输入')
    if (combined.aborted) fail('TIMEOUT', '输入辅助已超时')
    this.cache.set(key, { result, until: this.now() + 600000 })
    while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value)
    return { ...result, identity: p.identity }
  }
  clear() { this.cache.clear() }
}
module.exports = { ImeTranslationService, validatePreview }
