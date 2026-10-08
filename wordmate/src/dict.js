// ============================================================
// 本地词典兜底：读取 ECDICT 词典 CSV（可选，断网时保底）
// 文件位置：
//   1) 环境变量 WM_ECDICT 指定的路径
//   2) ~/Library/Application Support/WordMate/ecdict.csv
// 没有该文件时本模块静默跳过。数据源：github.com/skywind3000/ECDICT
// ============================================================
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { app } = require('electron')

let index = null // Map: word -> { phonetic, definitions: [{pos, meaning}] }

function dictPath() {
  return process.env.WM_ECDICT || path.join(app.getPath('userData'), 'ecdict.csv')
}

// 解析一行 CSV（处理带引号的字段）
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// 把 ECDICT 的 translation 字段（"n. 苹果\nvt. ..."）拆成结构化释义
function parseTranslation(translation) {
  return String(translation || '')
    .split('\\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((t) => {
      const m = t.match(/^([a-z]+\.?)\s+(.*)$/)
      return m ? { pos: m[1], meaning: m[2] } : { pos: '', meaning: t }
    })
}

// 首次使用时建立索引（大文件约需几秒，之后常驻内存）
async function buildIndex() {
  const file = dictPath()
  if (!fs.existsSync(file)) return null
  const map = new Map()
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let first = true
  for await (const line of rl) {
    if (first) { first = false; continue } // 跳过表头
    const c = parseCsvLine(line)
    if (!c || !c[0]) continue
    const word = c[0].toLowerCase()
    if (map.has(word)) continue
    map.set(word, { phonetic: c[1] || '', definitions: parseTranslation(c[3]) })
  }
  return map
}

async function lookup(word) {
  if (index === null) index = (await buildIndex()) || false // false = 无词典文件
  if (!index || !index.has(word)) return null
  const hit = index.get(word)
  return {
    word,
    phonetic_us: hit.phonetic,
    phonetic_uk: '',
    definitions: hit.definitions.length ? hit.definitions : [{ pos: '', meaning: '(无释义)' }],
    examples: [],
    collocations: [],
    synonyms_note: '',
  }
}

module.exports = { lookup }
