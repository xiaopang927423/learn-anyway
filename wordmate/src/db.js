// ============================================================
// 数据层：SQLite（better-sqlite3）
// 表：words 生词 / lookup_cache 查询缓存 / settings 设置
// ============================================================
const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const { randomUUID } = require('crypto')
const fs = require('fs')

let db = null

const DEFAULT_SETTINGS = {
  apiKey: '',   // API 密钥
  baseUrl: '',  // API 地址（OpenAI 兼容接口），留空用 DashScope 默认
  thinkingEnabled: false,
  thinkingParameter: 'auto',
  model: 'qwen-turbo',   // 模型名（可自定义）
  lastNotifiedDate: '',
  remindTime: '20:00',   // 每日复习提醒时间
  notifyEnabled: true,   // 是否开启系统通知提醒
  imeEnabled: false,
  imeAutoAdd: true,
  imeSaveContext: false,
  autoAdd: true,         // 查到的英文单词自动加入生词本
  dictationCount: 10,            // 每轮默写词数（0 = 全部）
  dictationAffectsSchedule: true, // 默写结果计入复习排程（同一词同日只计一次分）
}

// 本地时间字符串（YYYY-MM-DD HH:MM:SS），用于"今天"相关的统计
function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function init() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  db = new Database(path.join(app.getPath('userData'), 'wordmate.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT UNIQUE NOT NULL,
      phonetic TEXT DEFAULT '',
      definitions TEXT DEFAULT '[]',
      examples TEXT DEFAULT '[]',
      collocations TEXT DEFAULT '[]',
      synonyms_note TEXT DEFAULT '',
      forms TEXT DEFAULT '{}',
      memory_tip TEXT DEFAULT '',
      linked_words TEXT DEFAULT '[]',
      context TEXT DEFAULT '',
      source TEXT DEFAULT '',
      status TEXT DEFAULT 'learning',
      created_at TEXT,
      interval_days REAL DEFAULT 0,
      due_at TEXT,
      streak INTEGER DEFAULT 0,
      reviews INTEGER DEFAULT 0,
      last_reviewed_at TEXT,
      lookup_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS lookup_cache (
      word TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      looked_up_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS operation_receipts (
      request_id TEXT PRIMARY KEY, result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deleted_words (
      token TEXT PRIMARY KEY, row_json TEXT NOT NULL, deleted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER NOT NULL,
      source TEXT NOT NULL, grade INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ime_usage_events (
      commit_id TEXT PRIMARY KEY, word_id INTEGER NOT NULL,
      surface_form TEXT NOT NULL, source_meaning TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dictation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      mode TEXT DEFAULT 'm1',       -- m1 看义写词 / m2 听音写词（P1）
      outcome TEXT NOT NULL,        -- first_try 一次对 / retry 重试对 / fail 错或跳过
      typed TEXT DEFAULT '',        -- 用户实际输入，复盘错因用
      attempts INTEGER DEFAULT 1,
      created_at TEXT
    );
  `)
  // 老库迁移：给已存在的表补列（已存在会抛错，忽略即可）
  try { db.exec('ALTER TABLE words ADD COLUMN lookup_count INTEGER DEFAULT 0') } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE words ADD COLUMN forms TEXT DEFAULT '{}'`) } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE words ADD COLUMN memory_tip TEXT DEFAULT ''`) } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE words ADD COLUMN linked_words TEXT DEFAULT '[]'`) } catch { /* 列已存在 */ }
}

function ready() { return !!db }

// ---------------- 生词 ----------------
function hasWord(word) {
  return !!db.prepare('SELECT 1 FROM words WHERE word = ?').get(word)
}

// 每次查词 +1，返回新的次数（不在生词本则返回 0）
function incrementLookup(word) {
  db.prepare('UPDATE words SET lookup_count = lookup_count + 1 WHERE word = ?').run(word)
  const row = db.prepare('SELECT lookup_count FROM words WHERE word = ?').get(word)
  return row ? row.lookup_count : 0
}

function addWord(result, context, lookupCount = 0) {
  const info = db.prepare(`
    INSERT OR IGNORE INTO words (word, phonetic, definitions, examples, collocations, synonyms_note, forms,
                       memory_tip, linked_words, context, source, created_at, due_at, lookup_count)
    VALUES (@word, @phonetic, @definitions, @examples, @collocations, @synonyms_note, @forms,
            @memory_tip, @linked_words, @context, @source, @now, @now, @lookup_count)
  `).run({
    word: String(result.word).trim().toLowerCase(),
    lookup_count: lookupCount,
    phonetic: result.phonetic_us || result.phonetic || '',
    definitions: JSON.stringify(result.definitions || []),
    examples: JSON.stringify(result.examples || []),
    collocations: JSON.stringify(result.collocations || []),
    synonyms_note: result.synonyms_note || '',
    forms: JSON.stringify(result.forms && typeof result.forms === 'object' ? result.forms : {}),
    memory_tip: typeof result.memory_tip === 'string' ? result.memory_tip : '',
    linked_words: JSON.stringify(Array.isArray(result.linked_words) ? result.linked_words : []),
    context: context || '',
    source: result.source || '',
    now: localIso(),
  })
  const row = db.prepare('SELECT id FROM words WHERE word=?').get(String(result.word).trim().toLowerCase())
  return { ok: true, id: row.id, exists: info.changes === 0 }
}

// 批量判断哪些词已在生词本（"点词入本"界面用来标绿）
function hasWords(words) {
  const hit = []
  for (const w of words || []) {
    const k = String(w).toLowerCase()
    if (k && hasWord(k)) hit.push(k)
  }
  return hit
}

function atomic(fn) { return db.transaction(fn)() }
function receipt(requestId) {
  if (!requestId) return null
  const row = db.prepare('SELECT result FROM operation_receipts WHERE request_id = ?').get(requestId)
  return row ? JSON.parse(row.result) : null
}
function saveReceipt(requestId, result) {
  if (requestId) db.prepare('INSERT INTO operation_receipts VALUES (?, ?)').run(requestId, JSON.stringify(result))
  return result
}
function addLearningEvent(id, source, grade) {
  db.prepare('INSERT INTO learning_events (word_id,source,grade,created_at) VALUES (?,?,?,?)')
    .run(id, source, grade, localIso())
}
function removeWord(idOrWord) {
  return atomic(() => {
    const row = typeof idOrWord === 'number' ? getWordById(idOrWord)
      : db.prepare('SELECT * FROM words WHERE word = ?').get(String(idOrWord).toLowerCase())
    if (!row) return { ok: true, removed: false }
    const token = randomUUID()
    db.prepare('INSERT INTO deleted_words VALUES (?, ?, ?)').run(token, JSON.stringify(row), localIso())
    db.prepare('DELETE FROM words WHERE id = ?').run(row.id)
    return { ok: true, removed: true, undoToken: token, word: row.word, id: row.id }
  })
}
function restoreWord(token) {
  return atomic(() => {
    const item = db.prepare('SELECT * FROM deleted_words WHERE token = ?').get(String(token))
    if (!item) return { ok: false, error: '撤销记录不存在' }
    const row = JSON.parse(item.row_json)
    if (hasWord(row.word)) return { ok: false, error: '该词已重新收录，请先保留当前版本' }
    const keys = Object.keys(row)
    db.prepare(`INSERT INTO words (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]))
    db.prepare('DELETE FROM deleted_words WHERE token = ?').run(token)
    return { ok: true, id: row.id, word: row.word }
  })
}

function getWordById(id) {
  return db.prepare('SELECT * FROM words WHERE id = ?').get(id)
}

function listWords() {
  // 学习中的排前面，再按加入时间倒序
  return db.prepare(`
    SELECT words.*, (SELECT count(*) FROM ime_usage_events WHERE word_id = words.id) AS ime_use_count FROM words
    ORDER BY CASE status WHEN 'learning' THEN 0 ELSE 1 END, created_at DESC
  `).all()
}

function updateWord(id, patch) {
  if (!getWordById(id)) throw new Error('该词已删除')
  if (!patch || typeof patch !== 'object') throw new Error('无效修改')
  const allowed = ['context', 'definitions', 'examples', 'synonyms_note', 'forms', 'memory_tip', 'linked_words']
  const sets = [], vals = []
  for (const k of allowed) {
    if (!Object.hasOwn(patch, k)) continue
    let value = patch[k]
    if (['definitions', 'examples', 'forms', 'linked_words'].includes(k)) {
      value = typeof value === 'string' ? JSON.parse(value) : value
      if (k === 'forms' ? (!value || typeof value !== 'object' || Array.isArray(value)) : !Array.isArray(value)) throw new Error('无效字段：' + k)
      if (k === 'definitions' && (!value.length || value.some(x => !x || typeof x.meaning !== 'string' || !x.meaning.trim()))) throw new Error('请至少填写一条释义')
      value = JSON.stringify(value)
    } else if (typeof value !== 'string') throw new Error('无效字段：' + k)
    if (value.length > 50000) throw new Error('字段过长')
    sets.push(`${k} = ?`); vals.push(value)
  }
  if (!sets.length) return false
  db.prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return true
}
function setStatus(id, status) {
  if (!['learning', 'mastered'].includes(status)) throw new Error('无效学习状态')
  const row = getWordById(id)
  if (!row) throw new Error('该词已删除')
  if (status === 'learning' && row.status === 'mastered') {
    db.prepare("UPDATE words SET status = ?, due_at = ? WHERE id = ?").run(status, new Date().toISOString(), id)
  } else db.prepare('UPDATE words SET status = ? WHERE id = ?').run(status, id)
  return true
}

// ---------------- 复习调度相关查询 ----------------
function dueWords(nowIso) {
  return db.prepare(`
    SELECT * FROM words
    WHERE status = 'learning' AND reviews > 0 AND due_at IS NOT NULL AND due_at <= ?
    ORDER BY due_at ASC
  `).all(nowIso)
}

function newWords(limit) {
  return db.prepare(`
    SELECT * FROM words WHERE status = 'learning' AND reviews = 0
    ORDER BY created_at ASC LIMIT ?
  `).all(limit)
}

function newReviewedToday() {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM words
    WHERE reviews = 0 AND last_reviewed_at IS NOT NULL
      AND date(last_reviewed_at) = date('now', 'localtime')
  `).get().n
}

// 还没开始学的新词总数（用于角标：配额与库存取小）
function availableNewCount() {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM words WHERE status = 'learning' AND reviews = 0
  `).get().n
}

function updateSchedule(id, s) {
  db.prepare(`
    UPDATE words SET interval_days = ?, due_at = ?, streak = ?,
                     reviews = reviews + 1, last_reviewed_at = ?
    WHERE id = ?
  `).run(s.interval_days, s.due_at, s.streak, localIso(), id)
}

// ---------------- 默写 ----------------
function addDictationLog(row) {
  db.prepare(`INSERT INTO dictation_log (word, mode, outcome, typed, attempts, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.word, row.mode, row.outcome, row.typed, row.attempts, localIso())
  return true
}

// 今天默写过的词（构建队列时排除，同日不重复考）
function dictatedToday() {
  return db.prepare(`SELECT DISTINCT word FROM dictation_log
                     WHERE mode != 'practice' AND date(created_at) = date('now', 'localtime')`).all().map((r) => r.word)
}

// 该词今天是否已测验计分（复习或默写都会写 last_reviewed_at）——同日防双倍奖惩的关键
function reviewedToday(id) {
  return !!db.prepare(`SELECT 1 FROM words WHERE id = ?
                       AND date(last_reviewed_at) = date('now', 'localtime')`).get(id)
}

// ---------------- 查询缓存 ----------------
function getCache(word) {
  const row = db.prepare('SELECT result FROM lookup_cache WHERE word = ?').get(word)
  return row ? row.result : null
}

function saveCache(word, result) {
  db.prepare('INSERT OR REPLACE INTO lookup_cache (word, result, looked_up_at) VALUES (?, ?, ?)')
    .run(word, JSON.stringify(result), localIso())
}

// ---------------- 设置 ----------------
function getSettings() {
  const s = { ...DEFAULT_SETTINGS }
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { s[r.key] = JSON.parse(r.value) } catch { s[r.key] = r.value }
  }
  return s
}

function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('无效设置')
  if ('remindTime' in patch && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.remindTime)) throw new Error('无效提醒时间')
  if ('dictationCount' in patch && (!Number.isInteger(patch.dictationCount) || patch.dictationCount < 0 || patch.dictationCount > 200)) throw new Error('每轮默写词数必须为 0–200')
  for (const k of ['autoAdd', 'notifyEnabled', 'dictationAffectsSchedule', 'thinkingEnabled', 'imeEnabled', 'imeAutoAdd', 'imeSaveContext']) if (k in patch && typeof patch[k] !== 'boolean') throw new Error('无效开关')
  for (const k of ['baseUrl','apiKey','model']) if (k in patch && typeof patch[k] !== 'string') throw new Error('无效模型设置')
  if (patch.baseUrl) {
    const url = new URL(patch.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址须为 HTTP(S) 地址')
  }
  if ('thinkingParameter' in patch && !['auto','chat_template_kwargs','enable_thinking','none'].includes(patch.thinkingParameter)) throw new Error('无效 Thinking 参数')
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  atomic(() => { for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v))
  } })
  return getSettings()
}

function commitImeLearning(event) {
  return atomic(() => {
    const key = 'ime-learning:' + event.commitId
    const previous = receipt(key)
    if (previous) {
      if (previous.digest !== event.digest) throw Object.assign(new Error('确认事件编号冲突'), { code: 'INVALID_INPUT' })
      return { ...previous, replayed: true }
    }
    const settings = getSettings()
    if (!event.manual && (!settings.autoAdd || !settings.imeAutoAdd)) return saveReceipt(key, { saved: false, skipped: true, digest: event.digest })
    const context = settings.imeSaveContext ? event.context : ''
    const saved = addWord({ word: event.expression, definitions: [{ pos: '', meaning: event.sourceMeaning }], source: 'input-method' }, context, 0)
    db.prepare('INSERT INTO ime_usage_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(event.commitId, saved.id, event.expression, event.sourceMeaning, context, event.origin, localIso())
    return saveReceipt(key, { saved: true, id: saved.id, exists: saved.exists, digest: event.digest })
  })
}
function imeUsage(wordId) {
  return db.prepare('SELECT count(*) AS count FROM ime_usage_events WHERE word_id = ?').get(wordId).count
}

module.exports = {
  init, ready, localIso, commitImeLearning, imeUsage, atomic, receipt, saveReceipt, addLearningEvent, restoreWord,
  hasWord, hasWords, incrementLookup, addWord, removeWord, getWordById, listWords, updateWord, setStatus,
  dueWords, newWords, newReviewedToday, availableNewCount, updateSchedule,
  addDictationLog, dictatedToday, reviewedToday,
  getCache, saveCache, getSettings, saveSettings,
}
