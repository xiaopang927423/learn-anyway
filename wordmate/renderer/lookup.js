// ============================================================
// 查词窗口逻辑
// ============================================================
let current = null // 当前查询结果
let lookupSeq = 0 // 查询序号：只渲染最新一次查询的响应，防止慢的旧请求返回后覆盖新结果

const $ = (id) => document.getElementById(id)
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2000)
}

// 返回本次查询结果；等待期间若已发起更新的查询，则本次响应作废并返回 null
async function doLookup() {
  const word = $('word').value.trim()
  if (!word) return null
  const seq = ++lookupSeq
  $('loading').hidden = false
  current = null
  $('result').innerHTML = ''
  let r
  try { r = await wm.lookup(word, $('context').value.trim()) }
  catch (error) { r = { error: '查询失败：' + error.message } }
  if (seq !== lookupSeq) return null // 已有更新的查询在跑，旧响应不再上屏
  current = r
  $('loading').hidden = true
  render(current)
  return current
}

// 来源标注行（缓存 / AI / 本地词典）
function sourceLine(r) {
  const src = r.source === 'local_dict' ? '本地词典' : 'AI'
  return `<p class="source">${r.cached ? '<span class="badge-cached">⚡ 缓存</span> ' : ''}来源：${src}</p>`
}

function addCopy(text, label = '复制译文') {
  const button = document.createElement('button')
  button.className = 'big'; button.textContent = label
  button.onclick = () => ui.run(button, async () => { await wm.copyText(text); toast('已复制') })
  $('result').append(button)
}

function render(r) {
  if (r.error) {
    $('result').innerHTML = `<div class="error-box">${esc(r.error)}</div>` +
      (r.needSetup ? `<p class="center"><a class="link" href="#" data-open="settings">去设置 API Key →</a></p>` : '')
    return
  }

  // 中文查英文：展示地道英文表达和替代说法
  if (r.type === 'zh2en') {
    $('result').innerHTML = `
      <p class="crumb">${esc(r.word)} → 英文怎么说</p>
      <h2>${esc(r.translation)}</h2>
      ${(r.alternatives || []).length ? `<p class="muted">其它说法：${r.alternatives.map(esc).join('　·　')}</p>` : ''}
      ${(r.examples || []).map((ex) => `<p class="example">${esc(ex.en)}<br><span class="zh">${esc(ex.zh)}</span></p>`).join('')}
      ${r.notes ? `<p class="note-box">💡 ${esc(r.notes)}</p>` : ''}
      ${sourceLine(r)}
      <p class="tip">想加入生词本？直接查对应的英文单词即可</p>`
    addCopy(r.translation)
    return
  }

  // 句子翻译：译文 + 「点词入本」单词拆分
  if (r.type === 'sentence') {
    $('result').innerHTML = renderSentence(r)
    bindTokenAdd()
    addCopy(r.translation)
    return
  }

  let html = `<h2 class="word-head">${esc(r.word)}<button id="speakBtn" class="speak" title="朗读">🔊</button></h2>`
  // 修复：英/美音标缺一个时不再显示"英 "空尾巴
  const ph = [r.phonetic_us && `美 ${esc(r.phonetic_us)}`, r.phonetic_uk && `英 ${esc(r.phonetic_uk)}`]
    .filter(Boolean).join('　')
  if (ph) html += `<p class="phonetic">${ph}</p>`
  html += `<ul class="defs">` + (r.definitions || [])
    .map((d) => `<li><b>${esc(d.pos)}</b>${esc(d.meaning)}</li>`).join('') + `</ul>`
  html += formsHtml(r.forms) // 词形变化：复数/比较级/最高级/时态/派生词
  for (const ex of r.examples || []) {
    html += `<p class="example">${esc(ex.en)}<br><span class="zh">${esc(ex.zh)}</span></p>`
  }
  if ((r.collocations || []).length) {
    html += `<p class="muted">搭配：${r.collocations.map(esc).join(' · ')}</p>`
  }
  if (r.synonyms_note) html += `<p class="note-box">辨析：${esc(r.synonyms_note)}</p>`
  html += memoryHtml(r)
  html += linkedHtml(r, true) // 联想链条词可点击跳转查词
  html += sourceLine(r)

  html += r.inNotebook
    ? `<button id="removeBtn" class="big in-book" title="再次点击从生词本移除">✓ 已在生词本 · 点击移除</button>`
    : `<button id="addBtn" class="primary big">＋ 加入生词本</button>`

  $('result').innerHTML = html

  // 联想链条词：点一下换词并立即查询
  document.querySelectorAll('#result [data-lw]').forEach((el) => {
    el.onclick = () => { $('word').value = el.dataset.lw; $('context').value = ''; doLookup() }
  })

  const result = r
  const context = $('context').value.trim()
  const seq = lookupSeq
  const btn = $('addBtn')
  if (btn) btn.onclick = () => ui.run(btn, async () => {
    const response = await wm.addToNotebook({ result, context })
    if (response.ok === false) throw new Error('收录失败')
    result.inNotebook = true
    if (current === result && seq === lookupSeq) render(result)
  })
  const rm = $('removeBtn')
  if (rm) rm.onclick = () => ui.run(rm, async () => {
    const response = await wm.removeWord(result.word)
    if (!response.ok) throw new Error(response.error || '移除失败')
    result.inNotebook = false
    if (current === result && seq === lookupSeq) render(result)
    toast('已从生词本移除，可在生词本撤销最近一次删除')
    if (response.undoToken) localStorage.setItem('wordmate-undo', JSON.stringify({ token: response.undoToken, word: response.word }))
  })
  const speak = $('speakBtn')
  if (speak) speak.onclick = () => speakWord(result.word)
  addCopy(result.word + '\n' + result.definitions.map(d => `${d.pos || ''} ${d.meaning || ''}`).join('\n'), '复制单词和释义')
}

// ---------------- 句子「点词入本」 ----------------
let sentenceCtx = '' // 当前句子的英文一侧，点词入本时作为该词的上下文

// 把英文一侧拆成可点击的单词 + AI 难词标注
function renderSentence(r) {
  const userInput = $('word').value.trim()
  const isCn = /[一-鿿]/.test(userInput)
  // 英译汉：拆原句；汉译英：拆译文
  const enSentence = isCn ? (r.translation || '') : userInput
  sentenceCtx = enSentence
  const hw = Array.isArray(r.hard_words) ? r.hard_words : []
  const hardSet = new Set(hw.map((h) => String(h.word).toLowerCase()))

  const tokensHtml = enSentence
    .split(/([A-Za-z][A-Za-z'‘’-]*)/)
    .map((seg, idx) => {
      if (idx % 2 === 1) {
        const lw = seg.toLowerCase()
        const cls = hardSet.has(lw) ? 'tok hard' : 'tok'
        const hint = hardSet.has(lw) ? 'AI 难词 · 点击加入生词本' : '点击加入生词本'
        return `<span class="${cls}" data-w="${lw}" title="${hint}">${esc(seg)}</span>`
      }
      return esc(seg)
    })
    .join('')

  const chipsHtml = hw.length
    ? `<p class="hard-line">${hw.map((h) => {
        const lw = String(h.word).toLowerCase()
        return `<button class="hchip tok" data-w="${esc(lw)}" title="${esc(h.meaning)}">${esc(lw)}<span class="hm">${esc(h.meaning)}</span></button>`
      }).join('')}</p>`
    : ''

  return `
    <h2>整句翻译</h2>
    <p class="example sentence-result">${esc(r.translation)}</p>
    <div class="split-box">
      <p class="split-title">🔤 点词入本<span class="muted">　红字 = AI 挑出的难词，点句中任意单词即可查词并收录（自动带上本句作上下文）</span></p>
      <p class="tokens">${tokensHtml}</p>
      ${chipsHtml}
    </div>
    ${r.notes ? `<p class="note-box">💡 ${esc(r.notes)}</p>` : ''}
    ${sourceLine(r)}`
}

function bindTokenAdd() {
  document.querySelectorAll('#result [data-w]').forEach((el) => {
    el.onclick = () => addTokenWord(el)
  })
  // 已在生词本的词直接标绿
  const words = [...document.querySelectorAll('#result [data-w]')].map((e) => e.dataset.w)
  if (!words.length) return
  const seq = lookupSeq
  wm.checkWords(words).then((hitList) => {
    if (seq === lookupSeq) new Set(hitList).forEach(markWords)
  }).catch(error => ui.error(error))
}

function markWords(word) {
  document.querySelectorAll('#result [data-w]').forEach((e) => {
    if (e.dataset.w !== word) return
    e.classList.add('in-book')
    e.classList.remove('hard')
    e.title = '已在生词本'
  })
}

async function addTokenWord(el) {
  const word = el.dataset.w
  if (el.classList.contains('in-book')) { toast(`「${word}」已在生词本`); return }
  if (el.classList.contains('pending')) return
  el.classList.add('pending')
  try {
    const context = sentenceCtx
    const seq = lookupSeq
    const r = await wm.lookup(word, context)
    if (!r || r.error) { toast((r && r.error) || '查询失败，请稍后重试'); return }
    if (!r.inNotebook) {
      const response = await wm.addToNotebook({ result: r, context })
      if (response.ok === false) throw new Error('收录失败')
    }
    if (seq === lookupSeq) markWords(word)
    const d = (r.definitions || [])[0]
    toast(`✓ ${word} 已加入生词本${d ? '：' + ((d.pos || '') + ' ' + (d.meaning || '')).trim() : ''}`)
  } catch (error) {
    toast('加入失败：' + error.message)
  } finally {
    el.classList.remove('pending')
  }
}

// 发音（系统 TTS）
function speakWord(word) {
  const u = new SpeechSynthesisUtterance(word)
  u.lang = 'en-US'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

// 划词查词（⌥D / 右键「用 WordMate 翻译」）：主进程推送选中文本 → 自动查询 → 单词自动入生词本 → 朗读
wm.onLookupPrefill(async (word) => {
  $('word').value = word
  $('context').value = ''
  const r = await doLookup() // 用返回值而非 current：本次查询若已被更新的查询取代则为 null，不误入本
  if (!r || r.error || r.type !== 'word') return
  speakWord(r.word)
})

// 事件委托：所有 data-open 元素（页脚导航、错误提示里的链接、完成页按钮）统一跳转


// 输入法合成中的回车（isComposing / keyCode 229）是在确认候选词，不能触发查询
const imeComposing = (e) => e.isComposing || e.keyCode === 229

$('btn').onclick = doLookup
$('word').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !imeComposing(e)) { e.preventDefault(); doLookup() } })
$('context').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !imeComposing(e)) doLookup() }) // 修复：上下文框回车不能查询
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
// 窗口重新唤起时光标回到输入框并全选，改词即查
window.addEventListener('focus', () => $('word').select())

wm.onDataChanged(async event => {
  const result = current, seq = lookupSeq
  if (!result || result.error || event.type === 'lookup') return
  try {
    if (result.type === 'word') {
      const hits = await wm.checkWords([result.word])
      if (current === result && seq === lookupSeq) { result.inNotebook = hits.includes(result.word); render(result) }
    } else if (result.type === 'sentence') {
      const words = [...document.querySelectorAll('#result [data-w]')].map(el => el.dataset.w)
      const hits = new Set(await wm.checkWords(words))
      if (current !== result || seq !== lookupSeq) return
      document.querySelectorAll('#result [data-w]').forEach(el => el.classList.toggle('in-book', hits.has(el.dataset.w)))
    }
  } catch (error) { ui.error(error) }
})

$('clear').onclick = () => {
  lookupSeq++; current = null; sentenceCtx = ''
  $('word').value = ''; $('context').value = ''; $('loading').hidden = true
  $('result').innerHTML = '<div class="empty-state"><p>输入单词、短语或整句，回车查询</p></div>'
  $('word').focus()
}
