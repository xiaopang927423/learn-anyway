// ============================================================
// 复习卡片窗口逻辑
// 键盘：空格 = 翻面；1 = 不认识；2 = 模糊；3 = 认识
// ============================================================
let queue = null
let i = 0
let flipped = false
let requestId = null
let syncSeq = 0
let completed = 0
let grading = false // 评分请求未返回时，忽略连按，避免同一张卡重复评分

const $ = (id) => document.getElementById(id)
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
const parse = (s, fallback = []) => { try { return JSON.parse(s) ?? fallback } catch { return fallback } }

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2000)
}

// 当前卡片；复习完后返回 null（修复：此前在完成页按空格会因越界而崩溃）
function current() {
  return queue && i < queue.cards.length ? queue.cards[i] : null
}

function setProgress(pos) {
  const total = queue ? queue.cards.length : 0
  const cur = Math.min(pos, total)
  $('bar').style.width = (total ? (cur / total) * 100 : 100) + '%'
  $('counter').textContent = `${cur} / ${total}`
}

async function start() {
  try {
    queue = await wm.getReviewQueue()
    i = 0; completed = 0
    next()
  } catch (error) { ui.error(error); $('actions').innerHTML = '<button id=retry-load>重试加载</button>'; $('retry-load').onclick = start }
}

function next() {
  flipped = false
  requestId = crypto.randomUUID()
  const w = current()
  if (!w) return renderDone()
  setProgress(i + 1) // 显示当前是第几张

  // 把上下文句子里出现的单词挖空（公用 clozeText，见 forms.js）
  const ctx = w.context ? esc(clozeText(w.word, w.context)) : ''

  $('card').innerHTML = `
    <div class="tags">
      <span class="tag ${w.reviews ? 'tag-review' : 'tag-new'}">${w.reviews ? '复习' : '新词'}</span>
      ${(w.lookup_count || 0) > 1 ? `<span class="tag tag-hard">查过 ${w.lookup_count} 次 · 难词</span>` : ''}
    </div>
    <h2 class="card-word">${esc(w.word)}</h2>
    ${ctx ? `<p class="card-ctx">…${ctx}…</p>` : ''}
    <div id="back" hidden></div>`

  $('actions').innerHTML = `<button id="flip" class="primary big">显示答案<kbd>空格</kbd></button>`
  $('flip').onclick = flip
}

function flip() {
  const w = current()
  if (flipped || !w) return
  flipped = true
  const defs = parse(w.definitions)
  const examples = parse(w.examples)
  const cols = parse(w.collocations)
  $('back').hidden = false
  $('back').innerHTML = `
    ${w.phonetic ? `<p class="phonetic">${esc(w.phonetic)}</p>` : ''}
    <ul class="defs">${defs.map((d) => `<li><b>${esc(d.pos)}</b>${esc(d.meaning)}</li>`).join('')}</ul>
    ${formsHtml(w.forms)}
    ${examples.map((ex) => `<p class="example">${esc(ex.en)}<br><span class="zh">${esc(ex.zh)}</span></p>`).join('')}
    ${cols.length ? `<p class="muted">搭配：${cols.map(esc).join(' · ')}</p>` : ''}
    ${memoryHtml(w)}
    ${linkedHtml(w)}`
  $('actions').innerHTML = `
    <div class="grades">
      <button data-g="0" class="grade g-again">不认识<kbd>1</kbd></button>
      <button data-g="1" class="grade g-hard">模糊<kbd>2</kbd></button>
      <button data-g="2" class="grade g-good">认识<kbd>3</kbd></button>
    </div>`
  document.querySelectorAll('#actions [data-g]').forEach((b) => {
    b.onclick = () => grade(Number(b.dataset.g))
  })
}

async function grade(g) {
  const w = current()
  if (grading || !w || !flipped) return
  grading = true
  try {
    const r = await wm.gradeCard(w.id, g, { requestId, expectedReviews: w.reviews })
    if (!r || !r.ok) { toast('评分未保存，请重试'); return }
    if (r && r.suggestMaster) toast('这个词已经很熟了，可在生词本中标记「已掌握」')
    if (r.skipped) toast(r.reason)
    else completed++
    i++
    next()
  } catch (error) {
    toast('评分失败：' + error.message)
  } finally {
    grading = false
    await syncQueue()
  }
}

function renderDone() {
  flipped = false
  setProgress(queue ? queue.cards.length : 0)
  const total = completed
  $('card').innerHTML = `
    <div class="done">
      <div class="done-emoji">${total ? '🎉' : '🌱'}</div>
      <h2>${total ? '全部复习完成！' : '今天没有要复习的词'}</h2>
      <p class="muted">${total ? `本次共复习 ${total} 张卡片，坚持就是胜利` : '去查几个新词加入生词本，或稍后再来'}</p>
    </div>`
  // 复习后紧接产出测验（默写）是记忆黄金时点，完成页直接续上
  $('actions').innerHTML = `<div class="btn-row">
    <button class="primary big" data-practice>趁热默写一组</button>
    <button id="review-again" class="big">刷新到期词</button>
    <button class="big" data-open="lookup">去查词<kbd>⌥空格</kbd></button>
  </div>`
  $('review-again').onclick = start
}

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.target.closest('input, textarea, select, dialog')) return
  if (e.target.closest('button') && !e.target.closest('#flip, [data-g]')) return
  if (e.code === 'Space') {
    e.preventDefault()
    if (!flipped) flip() // flip/grade 内部有越界保护，完成页按空格不再崩溃
    return
  }
  if (flipped && ['1', '2', '3'].includes(e.key)) {
    grade(Number(e.key) - 1)
  }
})

// 完成页 / 空队列页的「去查词」按钮等：事件委托跳转


// 窗口被托盘重新唤起时刷新队列（修复：开着复习窗又通过 ⌥D 加了新词，回来却看不到）
// 只在「没开始」或「已复习完」时刷新，避免打断进行中的复习
wm.onReviewRefresh(() => {
  const done = !queue || i >= queue.cards.length
  if (done && !flipped) start()
})

start()

async function syncQueue(event = {}) {
  if (grading || !queue || i >= queue.cards.length) return
  const seq = ++syncSeq
  try {
    const fresh = await wm.getReviewQueue()
    if (seq !== syncSeq || grading) return
    const old = current()
    const eligible = new Map(fresh.cards.map(w => [w.id, w]))
    queue.cards = [...queue.cards.slice(0, i), ...queue.cards.slice(i).filter(w => eligible.has(w.id)).map(w => eligible.get(w.id))]
    if (!current() || old?.id !== current()?.id) { next(); toast('已同步其他窗口的学习状态') }
    else if (event.type === 'edit' && event.id === old.id) { const wasFlipped = flipped; next(); if (wasFlipped) flip() }
    else setProgress(i + 1)
  } catch (error) { ui.error(error) }
}
wm.onDataChanged(syncQueue)
window.addEventListener('focus', () => { if (queue && i < queue.cards.length) syncQueue(); else start() })
document.addEventListener('click', event => {
  if (event.target.closest('[data-practice]')) ui.run(null, () => wm.openWindow('dictationPractice'))
})

window.confirmNavigation = () => { if (grading) { toast('正在保存评分，请稍候'); return Promise.resolve(false) } return Promise.resolve(true) }
