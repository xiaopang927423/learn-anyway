const fs = require('fs')
const DIFFU = { baseUrl: 'http://43.107.54.53:31003/v1', model: 'diffu' }
function readDiffu(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const provider of Object.values(config.providers || {})) {
    const model = (provider.models || []).find(m => m.id === 'diffu')
    if (!model) continue
    const apiKey = provider.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Diffu 配置缺少 API Key')
    const baseUrl = model.baseUrl || provider.baseUrl
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('无效 API 地址')
    return { baseUrl: baseUrl.replace(/\/+$/, ''), model: model.id, apiKey: apiKey.trim() }
  }
  throw new Error('配置中没有 diffu 模型')
}
module.exports = { DIFFU, readDiffu }
