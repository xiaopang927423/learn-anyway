// 用真实 Chromium DOM 验证网页渲染；测试用 chrome mock 不接触用户浏览器。
const {app,BrowserWindow}=require('electron')
const fs=require('fs'),path=require('path'),assert=require('assert/strict')
const script=fs.readFileSync(path.join(__dirname,'../browser-extension/content.js'),'utf8')
let checks=0
function check(value,label){assert.ok(value,label);checks++;console.log('PASS',label)}
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}})
 const fixture=`<!doctype html><html><meta charset=utf-8><body style="font:18px/1.8 system-ui;max-width:700px;margin:70px auto"><h1>Workplace English</h1><p id=sentence>Please <strong>check</strong> the <a href=https://example.com id=link>project</a> timeline.</p><p id=second>The team will streamline the workflow.</p><p style=display:none>Hidden private text</p><input value="Private form"><div contenteditable=true>Editable draft</div><pre>const apiKey = 'private';</pre><p id=long></p></body></html>`
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(fixture))
 const run=code=>win.webContents.executeJavaScript(code)
 async function until(code){const stop=Date.now()+6000;while(Date.now()<stop){if(await run(code))return;await new Promise(r=>setTimeout(r,25))}throw Error('Timeout: '+code)}
 try{
  await run(`window.testRequests=[];window.listener=null;window.failure=false;window.delay=0;window.wordResult=false;window.panels=[];
    const originalAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const root=originalAttach.call(this,options);window.panels.push(root);return root};
    window.chrome={runtime:{onMessage:{addListener:fn=>window.listener=fn},sendMessage:async message=>{window.testRequests.push(message);if(window.delay)await new Promise(r=>setTimeout(r,window.delay));return window.failure ? {ok:false,error:'连接失败'}:{ok:true,result:window.wordResult?{type:'word',word:message.text,definitions:[{pos:'n.',meaning:'<img src=x onerror=alert(1)> 安全释义'}]}:{type:'sentence',translation:'译文：'+message.text}}}}};true`)
  await run(script)
  await run("window.listener({command:'page',target:'zh'},null,()=>{});true")
  await until("document.querySelectorAll('[data-wordmate-translation]').length===3")
  check(await run("testRequests.some(r=>r.text==='Please check the project timeline.')"),'inline emphasis and links translated as a complete paragraph')
  check(await run("!testRequests.some(r=>/Hidden|Private|Editable|apiKey/.test(r.text))"),'hidden text, forms, editable drafts and code excluded')
  check(await run("document.getElementById('link').getAttribute('href')==='https://example.com' && document.getElementById('sentence').textContent==='Please check the project timeline.'"),'original markup, text and links preserved')
  const before=await run('testRequests.length')
  await run("window.listener({command:'page',target:'zh'},null,()=>{});true")
  check(await run('testRequests.length')===before,'already translated nodes are not billed again')
  await run("document.getElementById('second').textContent='Updated page content.';window.listener({command:'page',target:'zh'},null,()=>{});true")
  await until("testRequests.some(r=>r.text==='Updated page content.')")
  check(await run("testRequests.some(r=>r.text==='Updated page content.')"),'dynamic changed paragraphs can be translated again')
  await run("window.listener({command:'restore'},null,()=>{});true")
  check(await run("document.querySelectorAll('[data-wordmate-translation]').length===0 && document.getElementById('second').textContent==='Updated page content.'"),'restore removes only translations and keeps site updates')
  await run("window.wordResult=true;window.listener({command:'selection',text:'timeline'},null,()=>{});true")
  await until("panels[0].textContent.includes('安全释义')")
  check(await run("panels[0].querySelectorAll('img').length===0"),'model response is rendered as text, not executed HTML')
  check(await run("panels[0].textContent.includes('timeline')"),'selected word renders inside webpage overlay')
  await run("const range=document.createRange();range.selectNodeContents(document.getElementById('link'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.getElementById('link').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));true")
  check(await run("!!document.querySelector('[data-wordmate-ui=selection-entry]')"),'selecting text shows a nearby translation entry')
  await run("panels[1].querySelector('button').click();true")
  await until("panels[0].textContent.includes('安全释义') && panels[0].textContent.includes('project')")
  check(await run("panels[0].textContent.includes('project')"),'selection entry opens translation beside selected word')
  await run("window.getSelection().removeAllRanges();window.wordResult=false;window.listener({command:'restore'},null,()=>{});document.getElementById('sentence').dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));true")
  await until("document.querySelectorAll('[data-wordmate-translation]').length===1")
  check(await run("document.querySelectorAll('[data-wordmate-translation]').length===1"),'Shift hover translates only one paragraph')
  await run("window.listener({command:'restore'},null,()=>{});true")
  await run("window.wordResult=false;window.delay=150;window.listener({command:'page',target:'zh'},null,()=>{});window.listener({command:'cancel'},null,()=>{});true")
  await new Promise(r=>setTimeout(r,250))
  check(await run("document.querySelectorAll('[data-wordmate-translation]').length===0"),'stop discards pending page results')
  await run("window.delay=0;window.failure=true;window.listener({command:'selection',text:'failed'},null,()=>{});true")
  await until("panels[0].textContent.includes('连接失败')")
  check(await run("[...panels[0].querySelectorAll('button')].some(b=>b.textContent==='重试')"),'selection failure has visible retry action')
  await run("window.failure=false;window.listener({command:'page',target:'zh'},null,()=>{});true")
  await until("document.querySelectorAll('[data-wordmate-translation]').length===3")
  fs.mkdirSync(path.join(__dirname,'../test-artifacts'),{recursive:true})
  fs.writeFileSync(path.join(__dirname,'../test-artifacts/browser-page.png'),(await win.webContents.capturePage()).toPNG())
  console.log('BROWSER_RENDER_OK checks='+checks);app.exit(0)
 }catch(error){console.error(error.stack);app.exit(1)}
})
