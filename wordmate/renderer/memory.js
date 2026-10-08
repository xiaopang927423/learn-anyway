// ============================================================
// 记忆方法（🧠）+ 单词联想链（🔗）统一渲染
// 查词窗、生词本、复习、默写共用；作为 <script> 先于各页面 js 引入
// 字段来自 AI 查词结果的 memory_tip / linked_words，
// 值可以是对象（AI 结果）或字符串（数据库里的 JSON），无内容返回空串
// ============================================================

// linked_words 可以是数组，也可以是库里存的 JSON 字符串；返回干净数组
function linkedList(linked) {
  let l = linked
  if (typeof l === 'string') {
    try { l = JSON.parse(l) } catch { l = null }
  }
  if (!Array.isArray(l)) return []
  return l.filter((x) => x && typeof x === 'object' && String(x.word || '').trim())
}

// 🧠 记忆方法框
function memoryHtml(item) {
  const tip = String((item && item.memory_tip) || '').trim()
  if (!tip) return ''
  return `<p class="mem-box">🧠 记忆法：${esc(tip)}</p>`
}

// 🔗 联想链词条；clickable=true 时词条可点击跳转查词（查词窗用），
// 点击行为由各页面自行绑定 [data-lw]
function linkedHtml(item, clickable) {
  const list = linkedList(item && item.linked_words)
  if (!list.length) return ''
  const chips = list.map((x) => {
    const w = String(x.word).trim().toLowerCase()
    const meta = [x.relation, x.meaning].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
    return `<span class="lchip${clickable ? ' clickable' : ''}"${
      clickable ? ` data-lw="${esc(w)}" title="点击查询这个词"` : ''
    }><b>${esc(w)}</b>${meta ? `<i>${esc(meta)}</i>` : ''}</span>`
  })
  return `<p class="linked">🔗 联想链 ${chips.join('')}</p>`
}
