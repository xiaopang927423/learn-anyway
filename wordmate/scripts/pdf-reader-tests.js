// Real PDF.js parsing/rendering and Chromium UI; model/native messaging are simulated.
const {app,BrowserWindow}=require('electron')
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../browser-extension')
function fixturePdf(scan=false){
 const stream=text=>`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
 const text=scan ? '' : 'BT /F1 18 Tf 40 750 Td (Workplace report) Tj /F1 12 Tf 0 -40 Td (The team will streamline the workflow.) Tj 0 -18 Td (Please check the project timeline.) Tj 0 -45 Td (A separate paragraph for translation.) Tj ET'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',stream(text),stream('BT /F1 12 Tf 40 750 Td (Second page has its own content.) Tj ET')]
 let data='%PDF-1.4\n', offsets=[0]
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const xref=Buffer.byteLength(data);data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
 return Buffer.from(data)
}
const mock=`<script>window.requests=[];window.delay=0;window.failure=false;window.allowPermission=true;window.chrome={permissions:{contains:async()=>location.search.includes('autoload=1'),request:async()=>window.allowPermission},runtime:{sendMessage:async message=>{window.requests.push(message);if(window.delay)await new Promise(resolve=>setTimeout(resolve,window.delay));if(window.failure)return {ok:false,error:'模拟模型失败'};return {ok:true,result:message.action==='add-word'?{inNotebook:true,notebookWord:'workflow'}:message.action==='selection'?{type:'word',word:'workflow',definitions:[{pos:'n.',meaning:'工作流程 <img src=x>'}]}:{translation:'译文：'+message.text}}}}};</script>`
let checks=0
function check(value,label){assert.ok(value,label);checks++;console.log('PASS',label)}
app.disableHardwareAcceleration()
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname==='/fixture.pdf'||url.pathname==='/scan.pdf'){res.setHeader('Content-Type','application/pdf');return res.end(fixturePdf(url.pathname==='/scan.pdf'))}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname))
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end()}
  res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream')
  const data=fs.readFileSync(file);res.end(file.endsWith('pdf-reader.html')?data.toString().replace('<script type="module"',mock+'<script type="module"'):data)
 }).listen(0,'127.0.0.1')
 await new Promise(resolve=>server.once('listening',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 const win=new BrowserWindow({width:1400,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 const run=code=>win.webContents.executeJavaScript(code)
 async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('Timeout: '+code+' status='+await run("document.getElementById('status').textContent"))}
 try{
  await win.loadURL(origin+'/pdf-reader.html?source='+encodeURIComponent(origin+'/fixture.pdf'))
  await until("document.getElementById('url').value.includes('fixture.pdf')")
  await run("document.getElementById('open-url').click()")
  await until("document.querySelectorAll('.paragraph').length===3")
  check(await run("document.getElementById('page-count').textContent==='/ 2' && document.getElementById('canvas').width>0 && document.querySelectorAll('.textLayer span').length>=4"),'actual PDF parser renders canvas, selectable text layer and two-page navigation')
  check(await run("document.querySelectorAll('.paragraph')[1].querySelector('.source').textContent.includes('workflow. Please')"),'PDF lines are combined into corresponding paragraphs')
  await run("document.getElementById('translate-page').click()")
  await until("[...document.querySelectorAll('.translation')].every(el=>el.textContent.startsWith('译文：'))")
  check(await run("requests.filter(r=>r.action==='page').length===3 && requests.every(r=>r.text.length<=4000)"),'PDF paragraph translation uses existing bridge with bounded text requests')
  await run("document.querySelectorAll('.paragraph')[1].click()")
  check(await run("document.querySelectorAll('.highlight').length===2 && document.querySelector('.paragraph.active').dataset.id==='1'"),'translated paragraph highlights corresponding original lines')
  await run("document.getElementById('mode').value='translated';document.getElementById('mode').dispatchEvent(new Event('change'));document.getElementById('translate-page').click()")
  check(await run("getComputedStyle(document.querySelector('.source')).display==='none' && requests.length===3"),'reading mode and repeated translation reuse completed translations')
  await run("document.getElementById('zoom').value='1.25';document.getElementById('zoom').dispatchEvent(new Event('change'))")
  await until("document.getElementById('canvas').style.width==='750px' && document.querySelectorAll('.paragraph').length===3")
  check(await run("document.querySelector('.translation').textContent.startsWith('译文：')"),'zoom rerenders PDF without discarding translation cache')
  await run("const range=document.createRange();const span=[...document.querySelectorAll('.textLayer span')].find(el=>el.textContent.includes('workflow'));range.setStart(span.firstChild,29);range.setEnd(span.firstChild,37);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);document.getElementById('translate-selection').click()")
  await until("!document.getElementById('add-word').hidden")
  check(await run("document.getElementById('selection-result').textContent.includes('工作流程 <img src=x>') && document.getElementById('selection-result').querySelector('img')===null"),'PDF selection uses dictionary response and renders model content as text')
  await run("document.getElementById('add-word').click()")
  await until("document.getElementById('add-word').textContent.includes('已收录')")
  check(await run("requests.some(r=>r.action==='add-word')"),'PDF dictionary result can be explicitly added to notebook')
  await run("window.failure=true;document.getElementById('next').click()")
  await until("document.querySelectorAll('.paragraph').length===1 && document.getElementById('page-number').value==='2'")
  await run("document.getElementById('translate-page').click()")
  await until("document.querySelector('.paragraph .error')!==null")
  check(await run("document.querySelector('.paragraph').textContent.includes('模拟模型失败')"),'failed PDF paragraph keeps source with retry action')
  await run("window.failure=false;document.querySelector('.paragraph button').click()")
  await until("document.querySelector('.translation').textContent.startsWith('译文：') && !document.querySelector('.paragraph .error')")
  check(true,'failed paragraph retries successfully')
  await run("document.getElementById('target').value='en';document.getElementById('target').dispatchEvent(new Event('change'));window.delay=500;document.getElementById('translate-page').click();document.getElementById('stop').click()")
  await new Promise(resolve=>setTimeout(resolve,650))
  check(await run("document.querySelector('.translation').textContent==='尚未翻译'"),'stop discards in-flight response instead of writing stale translation')
  await run("window.delay=0;document.getElementById('auto').checked=true;document.getElementById('previous').click()")
  await until("document.querySelectorAll('.paragraph').length===3 && [...document.querySelectorAll('.translation')].every(el=>el.textContent.startsWith('译文：'))")
  check(await run("requests.filter(r=>r.action==='page' && r.target==='en').length===4"),'automatic page translation and target-specific cache stay isolated')
  await run("document.getElementById('restore').click()")
  check(await run("!document.getElementById('auto').checked && [...document.querySelectorAll('.translation')].every(el=>el.textContent==='尚未翻译')"),'restore clears translations and disables automatic translation')
  await run("window.delay=500;document.getElementById('translate-page').click();document.getElementById('url').value=location.origin+'/scan.pdf';document.getElementById('open-url').click()")
  await until("document.getElementById('status').textContent.includes('本页没有可提取文字')")
  await new Promise(resolve=>setTimeout(resolve,650))
  check(await run("document.querySelectorAll('.paragraph').length===0 && document.getElementById('translate-page').disabled"),'scan-only PDF explains OCR boundary and document switching ignores old responses')
  await run("window.allowPermission=false;document.getElementById('url').value='https://example.com/file.pdf';document.getElementById('open-url').click()")
  await until("document.getElementById('status').textContent.includes('未授予')")
  check(true,'remote URL denial provides local-file fallback')
  await run("(async()=>{window.delay=0;const blob=await (await fetch('/fixture.pdf')).blob();const transfer=new DataTransfer();transfer.items.add(new File([blob],'local-test.pdf',{type:'application/pdf'}));document.getElementById('file').files=transfer.files;document.getElementById('file').dispatchEvent(new Event('change'));return true})()")
  await until("document.querySelectorAll('.paragraph').length===3")
  check(await run("document.title.includes('local-test.pdf')"),'local File input opens PDF without remote-site permission')
  fs.mkdirSync(path.resolve(__dirname,'../test-artifacts'),{recursive:true})
  await run("document.getElementById('close-selection').click();document.getElementById('target').value='zh';document.getElementById('target').dispatchEvent(new Event('change'));document.getElementById('mode').value='bilingual';document.getElementById('mode').dispatchEvent(new Event('change'));document.getElementById('translate-page').click()")
  await until("[...document.querySelectorAll('.translation')].every(el=>el.textContent.startsWith('译文：'))")
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/pdf-reader-fixture.pdf'),fixturePdf())
  fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/pdf-reader.png'),(await win.webContents.capturePage()).toPNG())
  win.setContentSize(390,900)
  check(await run("document.documentElement.scrollWidth<=window.innerWidth"),'reader controls and panels fit narrow windows')
  await win.loadURL(origin+'/pdf-reader.html?source='+encodeURIComponent(origin+'/fixture.pdf')+'&autoload=1&inline=1')
  await until("document.querySelectorAll('.paragraph').length===3 && [...document.querySelectorAll('.translation')].every(el=>el.textContent.startsWith('译文：'))")
  check(await run("document.getElementById('open-controls').hidden && !document.getElementById('return-original').hidden && requests.filter(r=>r.action==='page').length===3"),'same-tab entry automatically loads and translates current PDF with no file-open step')
  console.log('PDF_READER_OK checks='+checks)
  win.destroy();server.close();app.exit(0)
 }catch(error){console.error(error.stack);win.destroy();server.close();app.exit(1)}
})
