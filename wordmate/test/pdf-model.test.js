const {test} = require('node:test'), assert = require('node:assert/strict')
const model = import('../browser-extension/pdf-model.mjs')
const viewport = {width:600,transform:[1,0,0,-1,0,800]}
const transform = (a,b) => [b[0],b[1],b[2],-b[3],b[4],800-b[5]]
const item = (str,x,y,width=180,size=12) => ({str,width,transform:[size,0,0,size,x,800-y]})
test('PDF paragraphs join broken lines, undo hyphenation, preserve bullets and coordinates',async()=>{
 const {paragraphs}=await model
 const blocks=paragraphs([item('A trans-',40,40),item('lation example.',40,56),item('• New point',40,100)],viewport,transform)
 assert.equal(blocks[0].text,'A translation example.');assert.equal(blocks[0].rects.length,2);assert.equal(blocks[1].text,'• New point')
 assert.equal(blocks[0].rects[0].x,40)
})
test('PDF columns read left before right while retaining full-width headings',async()=>{
 const {paragraphs}=await model
 const items=[item('Report title',40,15,520,20)]
 for(let i=0;i<3;i++){items.push(item('Left '+i,40,60+i*18),item('Right '+i,330,60+i*18))}
 const blocks=paragraphs(items,viewport,transform)
 assert.equal(blocks[0].text,'Report title');assert.match(blocks[1].text,/Left 0 Left 1 Left 2/);assert.match(blocks[2].text,/Right 0 Right 1 Right 2/)
})
test('PDF request chunks respect bridge size without splitting Unicode pairs',async()=>{
 const {chunks}=await model, text='a'.repeat(3999)+'😀'+'b'.repeat(4100)
 const parts=chunks(text);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>part.length<=4000));assert.equal(parts[0].length,3999)
})
test('PDF URL parser rejects non-network URLs and embedded credentials',async()=>{
 const {remotePdfUrl}=await model
 for(const url of ['file:///secret.pdf','javascript:alert(1)','https://user:password@example.com/a.pdf'])assert.throws(()=>remotePdfUrl(url))
 assert.equal(remotePdfUrl('https://example.com/a.pdf#page=2').href,'https://example.com/a.pdf')
})

test('narrow PDF column gutters never combine adjacent left/right lines',async()=>{
 const {paragraphs}=await model,items=[]
 for(let i=0;i<4;i++)items.push(item('Left narrow '+i,40,60+i*18,250),item('Right narrow '+i,310,60+i*18,250))
 const blocks=paragraphs(items,viewport,transform)
 assert.equal(blocks.length,2);assert.ok(blocks[0].text.includes('Left narrow 3'));assert.ok(!blocks[0].text.includes('Right'));assert.ok(!blocks[1].text.includes('Left'))
})
