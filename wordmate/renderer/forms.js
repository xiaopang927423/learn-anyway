// ============================================================
// 词形变化统一渲染：屈折变化（复数/比较级/最高级/时态）
// + 派生变化（形容词/副词/名词/动词形式，含人称名词等）
// + 挖空句子（复习卡 / 默写题公用）
// 查词窗、生词本、复习窗、默写窗共用；作为 <script> 先于各页面 js 引入
// ============================================================
const FORM_LABELS = {
  plural: '复数',
  comparative: '比较级',
  superlative: '最高级',
  third_person: '三单',
  past_tense: '过去式',
  past_participle: '过去分词',
  present_participle: '现在分词',
  adverb_form: '副词形式',
  noun_form: '名词形式',
  adjective_form: '形容词形式',
  verb_form: '动词形式',
  person_noun: '指人名词',
}

// AI 偶尔会返回的别名 → 统一成规范键（找不到规范键时才用别名值）
const FORM_ALIASES = {
  adverb: 'adverb_form',
  noun: 'noun_form',
  adjective: 'adjective_form',
  adj: 'adjective_form',
  adv: 'adverb_form',
  verb: 'verb_form',
  third_person_singular: 'third_person',
  ing_form: 'present_participle',
  ed_form: 'past_tense',
}

// forms 可以是对象，也可以是库里存的 JSON 字符串；无内容返回空串
function formsHtml(forms) {
  let f = forms
  if (typeof f === 'string') {
    try { f = JSON.parse(f) } catch { f = null }
  }
  if (!f || typeof f !== 'object') return ''
  f = { ...f }
  for (const [alias, canonical] of Object.entries(FORM_ALIASES)) {
    if (f[alias] && !f[canonical]) f[canonical] = f[alias]
  }
  const chips = Object.entries(FORM_LABELS)
    .filter(([k]) => f[k] && String(f[k]).trim())
    .map(([k, label]) => `<span class="fchip"><i>${label}</i>${esc(String(f[k]).trim())}</span>`)
  return chips.length ? `<p class="forms">🔀 ${chips.join('')}</p>` : ''
}

// 把句子里出现的单词挖空为 _____（复习题干 / 默写题干公用）；
// \b 词边界 + 常见后缀，避免 can 把 canvas 一起挖掉；返回原文未转义
function clozeText(word, text) {
  if (!word || !text) return ''
  const safeWord = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`\\b${safeWord}(s|es|ed|d|ing|ly)?\\b`, 'gi'), '_____')
}
