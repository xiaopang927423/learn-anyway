const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeReview } = require('../src/sentence-review')
const ai = require('../src/ai')
const issue = (original, replacement, extra = {}) => ({original,replacement,kind:'grammar',severity:'error',explanation:'主谓一致',...extra})
const review = issues => ({translation:'她去学校。',summary:'有主谓一致问题。',issues})
test('quoted corrections map to exact UTF-16 offsets and preserve untouched text', () => {
  const source = '😀 She go to school; he go too.'
  const r = normalizeReview(review([issue('go','goes',{occurrence:1}),issue('go','goes')]), source)
  assert.equal(r.grammar.corrected,'😀 She goes to school; he goes too.')
  for (const i of r.grammar.issues) assert.equal(source.slice(i.start,i.end),i.original)
  assert.equal(r.original,source)
})
test('hallucinated, overlapping, unchanged and ambiguous indices are rejected', () => {
  for (const issues of [[issue('went','goes')],[issue('She go','She goes'),issue('go','goes')],[issue('go','go')],[issue('go','goes',{occurrence:-1})]]) {
    assert.throws(()=>normalizeReview(review(issues),'She go to school.'))
  }
})
test('natural English and Chinese translation do not invent corrections', () => {
  const r = normalizeReview(review([]),'She goes to school.')
  assert.equal(r.grammar.status,'ok'); assert.equal(r.grammar.corrected,r.original)
  const zh = normalizeReview(review([]),'她去学校。')
  assert.equal(zh.grammar.status,'not_applicable')
})
test('expression suggestions are separate from errors and deletion is supported', () => {
  const r = normalizeReview(review([issue('very ','',{kind:'expression',severity:'suggestion'})]),'It is very good.')
  assert.equal(r.grammar.corrected,'It is good.')
  assert.equal(r.grammar.issues[0].severity,'suggestion')
})
test('sentence review retries invalid spans and keeps the validated source', async () => {
  const original=global.fetch;let calls=0
  global.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);assert.match(body.messages[0].content,/occurrence/)
    calls++
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(review([issue(calls===1?'went':'go','goes')]))}}]})}
  }
  try {
    const r=await ai.reviewSentence('She go to school.','',{model:'fixture',apiKey:'test'})
    assert.equal(r.grammar.corrected,'She goes to school.');assert.equal(calls,2)
  } finally {global.fetch=original}
})
test('sentence review propagates cancellation and rejects overlong text before fetch', async () => {
  const original=global.fetch;let calls=0
  global.fetch=async(_url,{signal})=>{calls++;signal.throwIfAborted();throw new Error('unexpected')}
  try {
    await assert.rejects(ai.reviewSentence('x'.repeat(4001),'',{}));assert.equal(calls,0)
    const c=new AbortController();c.abort()
    await assert.rejects(ai.reviewSentence('She go to school.','',{},c.signal),/abort/i)
    assert.ok(calls<=1)
  } finally {global.fetch=original}
})
