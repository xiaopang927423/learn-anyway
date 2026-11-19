// Actual Electron/preload/IPC with an isolated DB and deterministic model fixture.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict')
process.env.WM_USER_DATA=fs.mkdtempSync(path.join(os.tmpdir(),'wordmate-sentence-ui-'))
process.env.WM_TEST_SUITE='1'
const {app,BrowserWindow}=require('electron'),runtime=require('../main'),db=require('../src/db'),ai=require('../src/ai')
const {normalizeReview}=require('../src/sentence-review')
async function until(fn){for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw new Error('UI condition timed out')}
app.whenReady().then(async()=>{
 try{
  db.saveSettings({apiKey:'fixture',autoAdd:false,notifyEnabled:false})
  const source='She go to school.'
  const result=normalizeReview({translation:'她去学校。',summary:'主谓一致需要修正。',issues:[{original:'go',replacement:'goes',kind:'grammar',severity:'error',explanation:'第三人称单数主语需要 goes。'}]},source)
  ai.reviewSentence=async()=>result
  const win=runtime.open('lookup'),run=code=>win.webContents.executeJavaScript(code)
  await until(()=>!win.webContents.isLoading())
  await run(`$('lookupMode').value='sentence';$('word').value=${JSON.stringify(source)};doLookup()`)
  assert.equal(await run("document.querySelector('.grammar-error').textContent"),'go')
  assert.equal(await run("document.querySelector('.grammar-corrected').textContent"),'She goes to school.')
  assert.match(await run("document.querySelector('.grammar-issues').textContent"),/第三人称/)
  const escaped=normalizeReview({translation:'示例',summary:'<img src=x onerror=alert(1)>',issues:[{original:'go',replacement:'<script>goes</script>',kind:'expression',severity:'suggestion',explanation:'<b>只是文本</b>'}]},source)
  await run(`render(${JSON.stringify(escaped)})`)
  assert.equal(await run("document.querySelector('.grammar-card script, .grammar-card img, .grammar-card b')===null"),true)
  assert.equal(await run("document.querySelector('.grammar-suggestion').textContent"),'go')
  let release
  ai.reviewSentence=()=>new Promise(r=>{release=r})
  await run("$('word').value='He go to work.';doLookup();true")
  await until(()=>!!release)
  await run("$('word').value='I am editing a newer sentence.';$('word').dispatchEvent(new Event('input'));true")
  release(result)
  await until(()=>run("!$('loading').hidden === false"))
  await new Promise(r=>setTimeout(r,100))
  assert.equal(await run("$('word').value"),'I am editing a newer sentence.')
  assert.equal(await run("document.querySelector('.grammar-card')===null"),true)
  await run(`$('word').value=${JSON.stringify(source)};render(${JSON.stringify(result)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  const image=await win.webContents.capturePage()
  const target=path.resolve(__dirname,'../../outputs/sentence-review-test.png');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,image.toPNG())
  console.log('SENTENCE_UI_OK highlights, correction, explanations, optional suggestions, escaping, stale response; '+target)
  for(const w of BrowserWindow.getAllWindows())w.destroy()
  app.exit(0)
 }catch(error){console.error(error);app.exit(1)}
})
