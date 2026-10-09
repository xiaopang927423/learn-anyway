const { createHash } = require('crypto')
function validateCommit(p) {
  const invalid = () => { throw Object.assign(new Error('采用事件无效'), { code: 'INVALID_INPUT' }) }
  if (!p || !/^[\w-]{8,100}$/.test(p.commitId || '') || p.confirmed !== true || !['fragment', 'annotation', 'manual'].includes(p.origin)) invalid()
  if (typeof p.adoptedExpression !== 'string' || p.adoptedExpression.length > 200 || !/^[A-Za-z][A-Za-z'’ -]*$/.test(p.adoptedExpression.trim())) invalid()
  if (typeof p.sourceMeaning !== 'string' || !p.sourceMeaning.trim() || [...p.sourceMeaning].length > 200) invalid()
  if (p.context != null && (typeof p.context !== 'string' || [...p.context].length > 200)) invalid()
  if (p.manual === true && p.origin !== 'manual') invalid()
  if (p.private === true) invalid()
  const event = { commitId: p.commitId, expression: p.adoptedExpression.trim().replace(/\s+/g, ' '), sourceMeaning: p.sourceMeaning.trim(), context: p.context || '', origin: p.origin, manual: p.manual === true }
  event.digest = createHash('sha256').update(JSON.stringify(event)).digest('hex')
  return event
}
function commitLearning(payload, db, changed = () => {}) {
  const event = validateCommit(payload)
  const result = db.commitImeLearning(event)
  if (result.saved && !result.replayed) changed('learning', result.id)
  return result
}
module.exports = { validateCommit, commitLearning }
