// ============================================================
// 间隔重复调度（简化版 SM-2 / 艾宾浩斯遗忘曲线）
// 自评：0 不认识 / 1 模糊 / 2 认识
// ============================================================
const db = require('./db')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

function addTime(from, ms) {
  return new Date(from.getTime() + ms).toISOString()
}

// 距上次复习的天数（没复习过则从入本时间算起）
function daysSince(localStr) {
  if (!localStr) return 0
  const t = new Date(String(localStr).replace(' ', 'T')).getTime()
  if (!t) return 0
  return Math.max(0, (Date.now() - t) / DAY)
}

// 复习优先级：查得越多越靠前（每次查 ×2），放得越久越靠前（每天 +1）
function priority(w) {
  return (w.lookup_count || 0) * 2 + daysSince(w.last_reviewed_at || w.created_at)
}

// 今日待复习队列：到期旧词优先，其后是所有没学过的新词（不设每日上限）
// 队列内部按优先级排序：反复查的难词、久未复习的词先出现
function getQueue() {
  const nowIso = new Date().toISOString()
  const due = db.dueWords(nowIso).sort((a, b) => priority(b) - priority(a))
  const fresh = db.newWords(-1).sort((a, b) => // SQLite 的 LIMIT -1 = 不限数量
    (b.lookup_count || 0) - (a.lookup_count || 0) ||
    String(a.created_at).localeCompare(String(b.created_at)))
  return {
    cards: [...due, ...fresh],
    dueCount: due.length,
    newCount: fresh.length,
  }
}

// 托盘角标数字 = 到期词数 + 未学新词数
function pendingCount() {
  const nowIso = new Date().toISOString()
  return db.dueWords(nowIso).length + db.availableNewCount()
}

// 为一张卡片评分，返回是否建议标记已掌握
function grade(id, g, options = {}) {
  return db.atomic(() => {
    const requestId = options.requestId ? 'grade:' + options.requestId : null
    const previous = db.receipt(requestId)
    if (previous) return { ...previous, replayed: true }
    const done = result => db.saveReceipt(requestId, result)
    if (![0, 1, 2].includes(g)) return done({ ok: false, error: '无效评分' })
    const w = db.getWordById(id)
    if (!w || w.status !== 'learning') return done({ ok: true, graded: false, skipped: true, reason: '该词已删除或已掌握' })
    if (options.expectedReviews !== undefined && options.expectedReviews !== w.reviews) return done({ ok: true, graded: false, skipped: true, reason: '该卡片已在另一个窗口完成评分' })
    const source = options.source === 'dictation' ? 'dictation' : 'review'
    const now = new Date()
    // 复习仅接受新词或实际到期的卡片；10 分钟后到期的重学仍可继续。
    if (source === 'review' && w.reviews > 0 && new Date(w.due_at).getTime() > now.getTime()) return done({ ok: true, graded: false, skipped: true, reason: '该卡片尚未到期' })
    if (source === 'dictation' && db.reviewedToday(id)) return done({ ok: true, graded: false, skipped: true, reason: '今天已计分' })
    let interval = w.interval_days || 0, streak = w.streak || 0, dueAt
    if (g === 0) { interval = 0; streak = 0; dueAt = addTime(now, 10 * MINUTE) }
    else if (g === 1) { interval = Math.min(365, Math.max(0.5, interval) * 1.5); streak = 0; dueAt = addTime(now, interval * DAY) }
    else { interval = interval < 1 ? 1 : Math.min(interval * 2.2, 365); streak++; dueAt = addTime(now, interval * DAY) }
    db.updateSchedule(id, { interval_days: interval, due_at: dueAt, streak })
    db.addLearningEvent(id, source, g)
    return done({ ok: true, graded: true, suggestMaster: g === 2 && streak >= 3 && interval >= 21 })
  })
}

module.exports = { getQueue, pendingCount, grade }
