// ============================================================
// 默写（M1 看义写词）：队列构建 + 判分回写
// 判定在渲染端做纯字符串比对（离线可用），这里只负责
// 记录 dictation_log 和与复习调度的联动（用户确认：默认联动）
// 成绩映射：一次写对=认识(2) / 重试后对=模糊(1) / 错或跳过=不认识(0)
// 同日防重复计分：该词今天已复习或已计过分 → 只记日志不动排程，
// 避免一次拼错被复习、默写双倍惩罚（反向亦然）
// ============================================================
const db = require('./db')
const scheduler = require('./scheduler')

// 默写队列：从复习队列（到期 + 新词，已按优先级排好）里
// 排除今天已复习 / 已默写过的词，取前 dictationCount 个（0 = 全部）
function buildQueue(practice = false) {
  const s = db.getSettings()
  const dictated = new Set(db.dictatedToday())
  const today = db.localIso().slice(0, 10)
  const pool = practice ? db.listWords().filter(w => w.status === 'learning') : scheduler.getQueue().cards.filter((w) =>
    !dictated.has(w.word) && !String(w.last_reviewed_at || '').startsWith(today))
  const n = Math.max(0, Math.floor(Number(s.dictationCount) || 0))
  return { cards: n > 0 ? pool.slice(0, n) : pool, poolCount: pool.length }
}

// 一次默写作答的回写：{ id, outcome, typed, attempts, mode }
function submit(payload = {}) {
  return db.atomic(() => {
    const requestId = payload.requestId ? 'dictation:' + payload.requestId : null
    const previous = db.receipt(requestId)
    if (previous) return { ...previous, replayed: true }
    const done = result => db.saveReceipt(requestId, result)
    const w = db.getWordById(Number(payload.id))
    if (!w || w.status !== 'learning') return done({ ok: true, skipped: true, graded: false, reason: '该词已删除或已掌握' })
    if (!['first_try', 'retry', 'fail'].includes(payload.outcome)) return done({ ok: false, error: '无效默写结果' })
    db.addDictationLog({ word: w.word, mode: payload.practice ? 'practice' : 'm1', outcome: payload.outcome,
      typed: String(payload.typed || '').trim().slice(0, 200), attempts: Math.min(2, Math.max(1, Number(payload.attempts) || 1)) })
    let result = { ok: true, graded: false }
    if (!payload.practice && db.getSettings().dictationAffectsSchedule !== false) {
      const g = payload.outcome === 'first_try' ? 2 : payload.outcome === 'retry' ? 1 : 0
      result = scheduler.grade(w.id, g, { source: 'dictation', expectedReviews: payload.expectedReviews })
      // 已在别处计分仍保留本次练习记录和正确率。
      if (result.skipped) result = { ...result, skipped: false }
    }
    return done(result)
  })
}
module.exports = { buildQueue, submit }
