// PDF text coordinates use a scale-1 viewport (top-left origin).
export function remotePdfUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含账号密码的 HTTP / HTTPS PDF 地址；本地 PDF 请用文件按钮打开。')
  url.hash = ''
  return url
}
export function chunks(text, limit = 4000) {
  const result = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + limit)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    result.push(text.slice(start, end)); start = end
  }
  return result
}
export function paragraphs(items, viewport, transform) {
  const words = items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const matrix = transform(viewport.transform, item.transform)
    const height = Math.max(1, Math.hypot(matrix[2], matrix[3]))
    return { text: item.str, x: matrix[4], y: matrix[5] - height, width: Math.abs(item.width), height, eol: item.hasEOL }
  }).sort((a,b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const word of words) {
    let row = rows.findLast(row => Math.abs(row.y - word.y) <= Math.min(row.height, word.height) * .35)
    if (!row) { row = { y: word.y, height: word.height, words: [] }; rows.push(row) }
    row.words.push(word)
  }
  const lines = []
  for (const row of rows) {
    row.words.sort((a,b) => a.x - b.x)
    let line
    for (const word of row.words) {
      const gap = line ? word.x - (line.x + line.width) : 0
      if (!line || gap > Math.max(word.height * 1.25, viewport.width * .015)) {
        line = { ...word }; lines.push(line)
      } else {
        line.text += (gap > word.height * .12 && !/\s$/.test(line.text) && !/^\s/.test(word.text) ? ' ' : '') + word.text
        line.width = Math.max(line.width, word.x + word.width - line.x)
        line.height = Math.max(line.height, word.height)
      }
    }
  }
  const midpoint = viewport.width / 2
  const left = line => line.x < midpoint && line.x + line.width <= midpoint + 12
  const right = line => line.x >= midpoint
  const columns = lines.filter(left).length >= 3 && lines.filter(right).length >= 3
  // Full-width lines divide sections; within each section read the left column first.
  let ordered = lines.sort((a,b) => a.y - b.y || a.x - b.x)
  if (columns) {
    const sections = [], segment = []
    for (const line of ordered) {
      if (!left(line) && !right(line)) {
        sections.push(...segment.splice(0).sort((a,b) => Number(right(a)) - Number(right(b)) || a.y - b.y), line)
      } else segment.push(line)
    }
    ordered = [...sections, ...segment.sort((a,b) => Number(right(a)) - Number(right(b)) || a.y - b.y)]
  }
  const blocks = []
  for (const line of ordered) {
    const previous = blocks.at(-1)
    const gap = previous ? line.y - previous.last.y : Infinity
    const sameColumn = previous && (!columns || right(line) === right(previous.last))
    const continuation = previous && sameColumn && gap >= 0 && gap <= previous.last.height * 1.7 &&
      Math.abs(line.height - previous.last.height) < previous.last.height * .25 &&
      Math.abs(line.x - previous.last.x) < line.height * 1.5 && !/^[•●▪]|^\d+[.)]\s/.test(line.text)
    if (continuation) {
      previous.text = /[A-Za-z]-$/.test(previous.text) && /^[a-z]/.test(line.text) ? previous.text.slice(0,-1) + line.text : previous.text + ' ' + line.text
      previous.rects.push(line); previous.last = line
    } else blocks.push({ text: line.text, rects: [line], last: line })
  }
  return blocks.map((block,index) => ({ id: index, text: block.text.trim(), rects: block.rects }))
}
