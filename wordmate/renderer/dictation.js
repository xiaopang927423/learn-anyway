// ============================================================
// 默写窗口逻辑（P0：M1 看义写词）
// 规则：一次重试 + 渐进提示——首错给字符级 diff + 首字母提示再试；
//       再错（或点「不会」）揭晓：正确拼写 + 播发音 + 🧠 记忆法 + 🔗 联想链
// 判定是纯本地字符串比对（归一化大小写/空白/连字符），零网络依赖
// 键盘：回车 = 提交 / 下一题；Esc 收起窗口
// ============================================================
let queue = null // { cards } 当前轮（错词重考时会被替换成错词表）
let i = 0
let phase = 'typing' // typing = 等待输入 | answered = 已出结果
let attempts = 0
let submitting = false // IPC 未返回时忽略连按
let mistakePile = [] // 本轮写错的词，轮末重考一遍
let stats = null
let practiceMode = new URLSearchParams(location.search).get('practice') === '1'
let roundRedo = false
let requestId = null
let syncSeq = 0
let loadSeq = 0

const $ = (id) => document.getElementById(id)
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
const parse = (s, fallback = []) => { try { return JSON.parse(s) ?? fallback } catch { return fallback } }

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2000)
}

// 归一化：小写 + 去空白/连字符/撇号（well known ≡ well-known ≡ wellknown）
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-'’]/g, '')

function current() {
  return queue && i < queue.cards.length ? queue.cards[i] : null
}

function setProgress(pos) {
  const total = queue ? queue.cards.length : 0
  const cur = Math.min(pos, total)
  $('bar').style.width = (total ? (cur / total) * 100 : 100) + '%'
  $('counter').textContent = `${cur} / ${total}`
}

async function start(practice = practiceMode) {
  if (submitting) return
  const seq = ++loadSeq
  practiceMode = practice === true
  roundRedo = false
  try { const result = await wm.getDictationQueue(practiceMode); if (seq !== loadSeq) return; queue = result }
  catch (error) { ui.error(error); $('actions').innerHTML = '<button id=retry-load>重试加载</button>'; $('retry-load').onclick = () => start(); return }
  i = 0
  mistakePile = []
  stats = { first: 0, retry: 0, fail: 0, reFixed: 0, wrong: [] }
  next()
}

function next() {
  if (i >= queue.cards.length) return finishRound()
  renderCard(current(), roundRedo)
}

function finishRound() {
  if (mistakePile.length) {
    roundRedo = true
    const redo = mistakePile
    mistakePile = []
    queue.cards = redo
    i = 0
    renderCard(current(), true) // 重考轮：再错不二次进错堆
  } else renderDone()
}

function advance() {
  if (phase !== 'answered' || submitting) return
  i++
  next()
}

// ---------------- 出题 ----------------
function renderCard(w, isRedo) {
  if (!w) return renderDone()
  phase = 'typing'
  requestId = crypto.randomUUID()
  attempts = 0
  setProgress(i + 1)

  const defs = parse(w.definitions)
  const exs = parse(w.examples)
  const d = defs[0] || {}
  // 例句优先：选包含目标词的例句挖空；没有则用当时语境句；都没有只给释义
  const hit = exs.find((e) => e && e.en && norm(e.en).includes(norm(w.word)))
  const clozeSrc = hit ? hit.en : w.context || ''
  const cloze = clozeSrc ? clozeText(w.word, clozeSrc) : ''

  $('card').innerHTML = `
    <div class="tags">
      <span class="tag">✍️ 默写</span>
      ${isRedo
        ? '<span class="tag tag-hard">错词重考</span>'
        : `<span class="tag ${w.reviews ? 'tag-review' : 'tag-new'}">${w.reviews ? '复习' : '新词'}</span>`}
    </div>
    <p class="d-prompt">${esc(`${d.pos || ''} ${d.meaning || '(无释义)'}`.trim())}</p>
    ${cloze ? `<p class="card-ctx">…${esc(cloze)}…${hit && hit.zh ? `<br><span class="zh">${esc(hit.zh)}</span>` : ''}</p>` : ''}
    <div class="d-input-row">
      <input id="ans" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="200" placeholder="拼出这个单词，回车提交">
    </div>
    <p id="imeWarn" class="ime-warn" hidden>⚠️ 检测到中文输入，请切换到英文输入法</p>
    <div id="feedback"></div>
    <div id="answer"></div>`

  const ans = $('ans')
  ans.focus()
  ans.oninput = () => { $('imeWarn').hidden = !/[^\x00-\x7F]/.test(ans.value) }
  // 输入法合成中的回车（isComposing / keyCode 229）是在确认候选词：不 preventDefault、不判分
  ans.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); check(isRedo) }
  }

  $('actions').innerHTML = `<button id="skipBtn" class="big">不会，直接看答案</button>`
  $('skipBtn').onclick = () => {
    if (phase !== 'typing' || submitting) return
    submitting = true
    attempts = Math.max(attempts, 1)
    answer(false, isRedo).finally(() => { submitting = false; syncQueue() })
  }
}

// ---------------- 判定 ----------------
async function check(isRedo) {
  if (phase !== 'typing' || submitting) return
  const w = current()
  if (!w) return
  const ans = $('ans')
  const typed = ans.value
  if (/[^\x00-\x7F]/.test(typed)) { $('imeWarn').hidden = false; ans.focus(); return }
  if (!typed.trim()) { ans.focus(); return }

  submitting = true
  try {
    attempts++
    if (norm(typed) === norm(w.word)) return await answer(true, isRedo)
    if (attempts === 1) {
      // 第一次错：diff + 首字母提示，留一次重试机会
      $('feedback').innerHTML = diffHtml(typed, w.word) +
        `<p class="hint-line">再试一次 · 提示 <b>${esc(letterHint(w.word))}</b>（共 ${w.word.length} 个字母）</p>`
      ans.value = ''
      ans.focus()
      return
    }
    await answer(false, isRedo)
  } finally {
    submitting = false
    await syncQueue()
  }
}

async function answer(right, isRedo) {
  const w = current()
  if (!w) return
  const typed = String($('ans').value || '')
  const outcome = right ? (attempts === 1 ? 'first_try' : 'retry') : 'fail'
  phase = 'saving'
  $('ans').disabled = true
  $('actions').innerHTML = '<p class="msg">保存结果中…</p>'
  let response
  try {
    response = await wm.submitDictation({ id: w.id, word: w.word, mode: 'm1', outcome, typed, attempts,
      practice: practiceMode || isRedo, requestId, expectedReviews: w.reviews })
    if (!response?.ok) throw new Error(response?.error || '结果未保存')
  } catch (error) {
    phase = 'save_failed'
    toast('保存失败，请点击重试；本题结果未丢失')
    $('actions').innerHTML = '<button id="retry-save" class="primary big">重试保存</button>'
    $('retry-save').onclick = async () => {
      if (submitting) return
      submitting = true
      try { await answer(right, isRedo) } finally { submitting = false; await syncQueue() }
    }
    return
  }
  if (response.skipped) { phase = 'answered'; i++; next(); toast(response.reason); return }
  phase = 'answered'
  if (right) {
    stats[outcome === 'first_try' ? 'first' : 'retry']++
    if (isRedo) stats.reFixed++
    $('feedback').innerHTML = `<p class="d-result ok">✓ ${esc(w.word)}</p>`
  } else {
    stats.fail++
    stats.wrong.push({ word: w.word, typed: typed.trim() })
    if (!isRedo) mistakePile.push(w)
    $('feedback').innerHTML = diffHtml(typed, w.word) + `<p class="d-reveal">正确拼写 <b>${esc(w.word)}</b> <button class="speak" id="speakBtn" title="再听一遍">🔊</button></p>`
    speakWord(w.word)
  }
  $('answer').innerHTML = answerHtml(w, !right)
  if (response.graded && response.suggestMaster) toast('这个词已经很熟了，可标记已掌握')
  if ($('speakBtn')) $('speakBtn').onclick = () => speakWord(w.word)
  $('actions').innerHTML = `<button id="nextBtn" class="primary big">${i + 1 >= queue.cards.length && mistakePile.length ? '重考错词' : '下一题'}<kbd>回车</kbd></button>`
  $('nextBtn').onclick = advance
}

// 答案区：释义 + 例句 + 词形变化（+ 错时的记忆法/联想链）
function answerHtml(w, withTip) {
  const defs = parse(w.definitions)
  const exs = parse(w.examples)
  return `<div class="d-answer">
    ${defs.length ? `<ul class="defs">${defs.map((x) => `<li><b>${esc(x.pos)}</b>${esc(x.meaning)}</li>`).join('')}</ul>` : ''}
    ${exs.length ? `<p class="example">${esc(exs[0].en)}<br><span class="zh">${esc(exs[0].zh)}</span></p>` : ''}
    ${formsHtml(w.forms)}
    ${withTip ? memoryHtml(w) + linkedHtml(w) : ''}
  </div>`
}

// ---------------- 字符级 diff ----------------
// Levenshtein 回溯出对齐操作序列：= 相同 / s 替换 / d 多写 / a 漏写
// 注意：s 同时携带两侧字符 [op, 写的, 该写的]，否则换序类错词的答案侧重建会错
function charDiff(t, a) {
  const n = t.length
  const m = a.length
  const dp = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let x = 1; x <= n; x++)
    for (let y = 1; y <= m; y++)
      dp[x][y] = t[x - 1] === a[y - 1] ? dp[x - 1][y - 1] : 1 + Math.min(dp[x - 1][y], dp[x][y - 1], dp[x - 1][y - 1])
  const ops = []
  let x = n
  let y = m
  while (x > 0 || y > 0) {
    if (x > 0 && y > 0 && t[x - 1] === a[y - 1]) { ops.push(['=', t[x - 1]]); x--; y-- }
    else if (x > 0 && y > 0 && dp[x][y] === dp[x - 1][y - 1] + 1) { ops.push(['s', t[x - 1], a[y - 1]]); x--; y-- }
    else if (x > 0 && dp[x][y] === dp[x - 1][y] + 1) { ops.push(['d', t[x - 1]]); x-- }
    else { ops.push(['a', a[y - 1]]); y-- }
  }
  return ops.reverse()
}

function diffHtml(typed, answer) {
  const raw = String(typed || '').trim()
  if (!raw) return `<p class="d-result">✗ <span class="muted">未拼写</span><span class="d-arrow">→</span><span class="d-ans">${esc(String(answer).toLowerCase())}</span></p>`
  const t = raw.toLowerCase()
  const a = String(answer).toLowerCase()
  let typedHtml = ''
  let ansHtml = ''
  for (const op of charDiff(t, a)) {
    if (op[0] === '=') { const c = esc(op[1]); typedHtml += c; ansHtml += c }
    else if (op[0] === 's') { // 替换：写的字母标红，该写的字母标绿
      typedHtml += `<u class="e">${esc(op[1])}</u>`; ansHtml += `<u class="m">${esc(op[2])}</u>`
    }
    else if (op[0] === 'd') typedHtml += `<u class="e x">${esc(op[1])}</u>` // 多写的字母
    else ansHtml += `<u class="m">${esc(op[1])}</u>` // 漏写的字母
  }
  return `<p class="d-result">✗ <span class="d-typed">${typedHtml}</span><span class="d-arrow">→</span><span class="d-ans">${ansHtml}</span>
    <span class="muted d-legend">红=写错/多写 · 绿=应补上的字母</span></p>`
}

// 首字母 + 下划线：r _ c _ _ _ e 风格（只给首字母，其它占位示长度）
function letterHint(word) {
  const s = String(word).toLowerCase()
  if (s.length <= 1) return s
  return `${s[0]} ${'_ '.repeat(s.length - 1).trim()}`
}

// ---------------- 结算报告 ----------------
function renderDone() {
  phase = 'done'
  const total = stats.first + stats.retry + stats.fail
  setProgress(queue.cards.length)
  const wrongList = stats.wrong.map((x) =>
    `<span class="lchip"><b>${esc(x.word)}</b><i>${x.typed ? '写成 ' + esc(x.typed) : '未拼出'}</i></span>`).join('')
  $('card').innerHTML = `
    <div class="done">
      <div class="done-emoji">${total ? '🖊️' : '🌱'}</div>
      <h2>${total ? '默写完成！' : '今天没有可默写的词'}</h2>
      ${total
        ? `<p class="muted">共 ${total} 次作答 · 一次对 ${stats.first} · 重试对 ${stats.retry} · 错 ${stats.fail}${
            stats.fail ? `（重考纠正 ${stats.reFixed}）` : ''}</p>`
        : `<p class="muted">词要么刚复习过、要么今天已默写过——可点击自由练习；同日已计分的词不会再次影响排程</p>`}
      ${wrongList ? `<p class="hard-line">🔁 错词：${wrongList}</p>` : ''}
    </div>`
  $('actions').innerHTML = `<div class="btn-row">
      <button id="practiceBtn" class="big">自由练习</button>
      <button id="againBtn" class="primary big">再来一组</button>
      <button class="big" data-open="review">去复习<kbd>空格</kbd></button>
    </div>`
  $('againBtn').onclick = () => start()
  $('practiceBtn').onclick = () => start(true)
}

// 发音（系统 TTS，与查词窗同一实现）
function speakWord(word) {
  const u = new SpeechSynthesisUtterance(word)
  u.lang = 'en-US'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

document.addEventListener('keydown', (e) => {
  if (e.repeat || (e.key === 'Enter' && e.target.closest('button'))) return
  if (e.key === 'Enter' && phase === 'answered') { e.preventDefault(); advance() }
  if (e.key === 'Escape') window.close()
})

// data-open 跳转（去复习等按钮）


// 窗口复用时刷新队列：只在没开始/已完成时刷新，不打断进行中的默写
wm.onDictationRefresh(() => {
  const done = !queue || i >= queue.cards.length
  if (done && !submitting) start()
})

start()

async function syncQueue(event = {}) {
  if (!queue || phase === 'done' || submitting || phase === 'save_failed') return
  const seq = ++syncSeq
  try {
    const fresh = await wm.listWords()
    if (seq !== syncSeq || submitting) return
    const old = current()
    const today = new Date().toLocaleDateString('en-CA')
    const learning = new Map(fresh.filter(w => w.status === 'learning').map(w => [w.id, w]))
    const eligible = new Map([...learning.values()].filter(w => practiceMode || roundRedo || (phase === 'answered' && w.id === old?.id) || !String(w.last_reviewed_at || '').startsWith(today)).map(w => [w.id,w]))
    mistakePile = mistakePile.filter(w => learning.has(w.id)).map(w => learning.get(w.id))
    queue.cards = [...queue.cards.slice(0,i), ...queue.cards.slice(i).filter(w => eligible.has(w.id)).map(w => {
      // 保留卡片版本以便主进程检测另一个窗口的评分；仅内容编辑替换显示。
      const updated = eligible.get(w.id)
      return { ...updated, reviews: w.reviews }
    })]
    if (!current() || old?.id !== current()?.id) { next(); toast('已移除删除或已掌握的词') }
    else if (event.type === 'edit' && event.id === old.id && phase === 'typing') {
      const text = $('ans').value, used = attempts
      renderCard(current(), roundRedo); $('ans').value = text; attempts = used
    }
    else setProgress(i + 1)
  } catch (error) { ui.error(error) }
}
wm.onDataChanged(syncQueue)
window.addEventListener('focus', () => { if (phase === 'done') start(); else syncQueue() })

wm.onDictationPractice(() => { if (!queue || phase === 'done') start(true); else { toast('请先完成当前组，再点击自由练习'); } })

window.confirmNavigation = () => { if (submitting || phase === 'saving' || phase === 'save_failed') { toast('请先完成当前结果的保存，再返回'); return Promise.resolve(false) } return Promise.resolve(true) }
