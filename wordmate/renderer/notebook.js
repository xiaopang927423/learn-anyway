// ============================================================
// 生词本窗口逻辑
// ============================================================
let allWords = []

const $ = (id) => document.getElementById(id)
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
const parse = (s, fallback = []) => { try { return JSON.parse(s) ?? fallback } catch { return fallback } }

let refreshSeq = 0
async function refresh() {
  const seq = ++refreshSeq
  try {
    const [words, pending] = await Promise.all([wm.listWords(), wm.getPending()])
    if (seq !== refreshSeq) return
    allWords = words
    const learning = allWords.filter(w => w.status === 'learning').length
    $('stats').innerHTML = `<span class="chip">${allWords.length} 词</span><span class="chip">${learning} 学习中</span><span class="chip">${pending} 待复习</span>`
    render()
  } catch (error) { ui.error(error) }
}

function firstMeaning(w) {
  const defs = parse(w.definitions)
  return defs.length ? `${defs[0].pos || ''} ${defs[0].meaning}`.trim() : '(无释义)'
}

function render() {
  const q = $('search').value.trim().toLowerCase()
  const rows = allWords.filter((w) =>
    !q || w.word.includes(q) || w.definitions.toLowerCase().includes(q)
  )
  if (!rows.length) {
    $('list').innerHTML = `<div class="empty-state">
      <div class="icon">${q ? '🔍' : '🗂️'}</div>
      <p>${q ? '没有匹配的单词' : '还没有生词，<a class="link" href="#" data-open="lookup">去查一个吧</a>'}</p>
    </div>`
    return
  }
  $('list').innerHTML = rows.map((w) => {
    const mastered = w.status === 'mastered'
    return `
    <div class="word-item ${mastered ? 'mastered' : ''}" data-id="${w.id}">
      <div class="main-row">
        <span class="chev">▶</span>
        <div class="info">
          <div class="w">${esc(w.word)} ${mastered ? '<span class="tag">已掌握</span>' : ''}</div>
          <div class="m">${esc(firstMeaning(w))}${(w.lookup_count || 0) > 1 ? `　·　查过 ${w.lookup_count} 次` : ''}${w.ime_use_count ? `　·　输入法采用 ${w.ime_use_count} 次` : ''}${w.context ? '　·　' + esc(w.context) : ''}</div>
        </div>
        <div class="ops">
          ${mastered
            ? `<button data-act="relearn">重新学习</button>`
            : `<button data-act="master">已掌握</button>`}
          <button data-act="edit">编辑</button>
          <button class="danger" data-act="del">删除</button>
        </div>
      </div>
      <div class="detail" hidden>${detailHtml(w)}</div>
    </div>`
  }).join('')

  document.querySelectorAll('.word-item').forEach((el) => {
    const id = Number(el.dataset.id)
    // 点整行展开/收起单词卡片（点按钮不算）
    el.querySelector('.main-row').onclick = (e) => {
      if (e.target.closest('button')) return
      toggleDetail(id)
    }
    el.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = () => ui.run(btn, async () => {
        const act = btn.dataset.act
        if (act === 'edit') { openEditor(id); return }
        if (act === 'del') {
          const result = await wm.removeWord(id)
          if (!result.ok) throw new Error(result.error || '删除失败')
          if (result.undoToken) {
            undo = { token: result.undoToken, word: result.word }
            localStorage.setItem('wordmate-undo', JSON.stringify(undo)); showUndo()
          }
        }
        if (act === 'master') await wm.setStatus(id, 'mastered')
        if (act === 'relearn') await wm.setStatus(id, 'learning')
        await refresh()
      })
    })
    el.querySelectorAll('[data-speak]').forEach((b) => {
      b.onclick = () => {
        const u = new SpeechSynthesisUtterance(b.dataset.speak)
        u.lang = 'en-US'
        speechSynthesis.cancel()
        speechSynthesis.speak(u)
      }
    })
  })
  applyExpanded() // 增删/标记后刷新时保持展开状态
}

// ---------------- 展开的单词卡片 ----------------
let expandedId = null // 同时只展开一张卡片

function toggleDetail(id) {
  expandedId = expandedId === id ? null : id
  applyExpanded()
}

function applyExpanded() {
  document.querySelectorAll('.word-item').forEach((el) => {
    const on = Number(el.dataset.id) === expandedId
    el.classList.toggle('expanded', on)
    el.querySelector('.detail').hidden = !on
  })
}

function fmtDue(w) {
  if (w.status === 'mastered') return '已掌握，不再复习'
  if (!w.reviews) return `未复习 · 加入于 ${esc((w.created_at || '').slice(0, 10))}`
  const due = w.due_at ? new Date(w.due_at) : null
  const dueTxt = !due ? '—' : due <= new Date()
    ? '今天到期'
    : due.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `已复习 ${w.reviews} 次 · 间隔 ${Math.round(w.interval_days * 10) / 10} 天 · 下次 ${dueTxt}`
}

function detailHtml(w) {
  const defs = parse(w.definitions)
  const exs = parse(w.examples)
  const cols = parse(w.collocations)
  return `
    <div class="detail-head">
      ${w.phonetic ? `<span class="phonetic">${esc(w.phonetic)}</span>` : ''}
      <button class="speak" data-speak="${esc(w.word)}" title="朗读">🔊</button>
      <span class="muted src-tag">${w.source === 'input-method' ? '输入法' : w.source === 'local_dict' ? '本地词典' : 'AI'}</span>
    </div>
    ${defs.length ? `<ul class="defs">${defs.map((d) => `<li><b>${esc(d.pos)}</b>${esc(d.meaning)}</li>`).join('')}</ul>` : '<p class="muted">（无释义）</p>'}
    ${formsHtml(w.forms)}
    ${w.context ? `<p class="example"><span class="zh">当时语境：</span>${esc(w.context)}</p>` : ''}
    ${exs.map((ex) => `<p class="example">${esc(ex.en)}<br><span class="zh">${esc(ex.zh)}</span></p>`).join('')}
    ${cols.length ? `<p class="muted">搭配：${cols.map(esc).join(' · ')}</p>` : ''}
    ${w.synonyms_note ? `<p class="note-box">辨析：${esc(w.synonyms_note)}</p>` : ''}
    ${memoryHtml(w)}
    ${linkedHtml(w)}
    <p class="sched">📅 ${esc(fmtDue(w))}</p>`
}

$('search').addEventListener('input', render)
// 页脚导航：事件委托统一处理

// 窗口重新唤起时自动刷新（期间可能在查词窗加了新词）
window.addEventListener('focus', refresh)
wm.onDataChanged(refresh)

let undo = null
try { undo = JSON.parse(localStorage.getItem('wordmate-undo')) } catch {}
function showUndo() {
  $('undo-line').hidden = !undo
  $('undo-label').textContent = undo ? `已删除 ${undo.word}` : ''
}
$('undo').onclick = () => ui.run($('undo'), async () => {
  const result = await wm.restoreWord(undo.token)
  if (!result.ok) throw new Error(result.error)
  undo = null; localStorage.removeItem('wordmate-undo'); showUndo(); await refresh()
})
let editingId = null
function openEditor(id) {
  const word = allWords.find(w => w.id === id)
  if (!word) return
  editingId = id
  $('edit-title').textContent = '编辑 ' + word.word
  $('edit-definitions').value = parse(word.definitions).map(d => `${d.pos || ''} | ${d.meaning || ''}`).join('\n')
  $('edit-examples').value = parse(word.examples).map(e => `${e.en || ''} | ${e.zh || ''}`).join('\n')
  $('edit-context').value = word.context || ''
  $('edit-memory').value = word.memory_tip || ''
  $('edit-error').textContent = ''
  $('editor').showModal()
}
$('edit-cancel').onclick = () => $('editor').close()
$('edit-form').onsubmit = async event => {
  event.preventDefault()
  const button = $('edit-save')
  if (button.disabled) return
  button.disabled = true
  try {
    const pairs = (value, first, second) => value.split('\n').filter(x => x.trim()).map(line => {
      const split = line.indexOf('|')
      return split < 0 ? { [first]: '', [second]: line.trim() } : { [first]: line.slice(0, split).trim(), [second]: line.slice(split + 1).trim() }
    })
    await wm.updateWord(editingId, { definitions: pairs($('edit-definitions').value, 'pos', 'meaning'),
      examples: pairs($('edit-examples').value, 'en', 'zh'), context: $('edit-context').value, memory_tip: $('edit-memory').value })
    $('editor').close(); await refresh()
  } catch (error) { $('edit-error').textContent = error.message }
  finally { button.disabled = false }
}
showUndo()
refresh()
