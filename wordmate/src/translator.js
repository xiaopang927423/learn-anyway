// ============================================================
// 翻译调度：本地缓存 → 云端 AI → 本地词典兜底
// 单个英文单词：走词典流程（可入生词本，可词典兜底）
// 句子/其它文本：走纯翻译流程（只缓存，不入生词本）
// ============================================================
const db = require('./db')
const ai = require('./ai')
const dict = require('./dict')

const SINGLE_WORD_RE = /^[a-zA-Z'‘’-]+$/ // 纯字母（允许 ASCII 撇号/弯撇号/连字符）= 单个英文单词

async function lookup(rawInput, context) {
  const input = String(rawInput || '').trim()
  if (!input) return { error: '请输入单词或句子' }

  if (input.length > 12000) return { error: '选中文本过长，请控制在 12000 字符以内' }
  const key = input.toLowerCase()
  const isSingleWord = SINGLE_WORD_RE.test(key)

  const isVocabulary = /^[a-zA-Z][a-zA-Z'‘’ -]*$/.test(input) && input.length <= 200
  let inNotebook = isVocabulary ? db.hasWord(key) : false
  const settings = db.getSettings()

  // 查询次数 +1（查得越多的词 = 越记不住，复习优先级越高）
  const lookupCount = inNotebook ? db.incrementLookup(key) : 0

  // 查到的英文单词自动入生词本（设置里可关）；句子/中译英不入本
  function ensureInNotebook(result) {
    if (inNotebook || !db.getSettings().autoAdd || !isVocabulary) return
    if (!result || result.type === 'sentence' || result.type === 'zh2en') return
    db.addWord({ ...result, word: key, source: result.source || '' }, context || '', lookupCount)
    inNotebook = true
  }

  // 模型、上下文和原始大小写均参与缓存键，避免切模型或换语境仍返回旧结果。
  const cacheKey = 'v3:' + require('crypto').createHash('sha256')
    .update(JSON.stringify([input, String(context || ''), settings.baseUrl, settings.model, settings.thinkingEnabled === true, settings.thinkingParameter || 'auto'])).digest('hex')

  // 1) 本地缓存：查过就秒出（句子翻译结果同样缓存）
  const cached = db.getCache(cacheKey)
  if (cached) {
    try {
      const r = JSON.parse(cached)
      ensureInNotebook(r)
      return { ...r, cached: true, inNotebook, word: key, lookup_count: lookupCount }
    } catch { /* 损坏的缓存重新查询 */ }
  }

  let result = null
  let source = ''
  let failure = ''

  // 2) 云端 AI
  if (settings.apiKey) {
    try {
      result = await ai.translate(input, context, settings)
      source = 'ai'
    } catch (err) {
      failure = /timeout|aborted/i.test(err.message) ? '请求超时（45 秒）' : err.message
      console.error('[ai] 查询失败:', failure)
    }
  }

  // 3) 本地词典兜底（只对单个单词生效，且需配置了 ECDICT）
  if (!result && isSingleWord) {
    result = await dict.lookup(key)
    if (result) {
      source = 'local_dict'
      result.type = 'word'
    }
  }

  if (!result) {
    return {
      word: key,
      type: isSingleWord ? 'word' : 'sentence',
      error: settings.apiKey
        ? '翻译失败：' + (failure || '本地词典没有该词')
        : '未配置 API Key，请在「设置」中填写后重试',
      needSetup: !settings.apiKey,
    }
  }

  result.word = key
  result.type = result.type || (isSingleWord ? 'word' : 'sentence')
  result.source = source
  ensureInNotebook(result)
  db.saveCache(cacheKey, result)
  return { ...result, source, cached: false, inNotebook, word: key, lookup_count: lookupCount }
}

// 加入生词本：payload = { result, context }；句子/中译英不允许入本
function addToNotebook(payload) {
  const result = payload && payload.result
  if (!result || typeof result.word !== 'string' || !/^[a-zA-Z][a-zA-Z'‘’ -]*$/.test(result.word) || result.word.length > 200) return { ok: false }
  if (!Array.isArray(result.definitions) || !result.definitions.length) return { ok: false }
  result.word = result.word.trim().toLowerCase()
  if (result.type === 'sentence' || result.type === 'zh2en') return { ok: false, reason: result.type }
  // 入本时带上已累计的查询次数
  return db.addWord({ ...result, source: result.source || '' }, (payload && payload.context) || '',
    result.lookup_count || 0)
}

module.exports = { lookup, addToNotebook }
