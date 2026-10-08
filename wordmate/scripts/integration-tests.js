// 在真实 Electron / SQLite ABI 下运行，数据与日常学习库隔离。
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict')
process.env.WM_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wordmate-regression-'))
process.env.WM_TEST_SUITE = '1'
const { app } = require('electron')
const runtime = require('../main')
const db = require('../src/db'), scheduler = require('../src/scheduler'), dictation = require('../src/dictation')
const Database = require('better-sqlite3')
let assertions = 0
function check(condition, message) { assert.ok(condition, message); assertions++; console.log('PASS', message) }
function seed(word) { db.addWord({ word, type:'word', definitions:[{pos:'n.',meaning:'测试释义'}], examples:[{en:'This is '+word+'.',zh:'测试例句'}] }, '', 1); return db.listWords().find(w => w.word === word) }
async function until(fn, label) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(r=>setTimeout(r,50)) }
  throw new Error('Timeout: ' + label)
}
async function page(name) {
  const win = runtime.open(name)
  await until(() => !win.webContents.isLoading(), name+' loaded')
  const errors = []
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message) })
  return { win, run: code => win.webContents.executeJavaScript(code), errors }
}
app.whenReady().then(async () => {
  let connection
  try {
    db.saveSettings({ notifyEnabled:false, autoAdd:false, apiKey:'' })
    connection = new Database(path.join(process.env.WM_USER_DATA,'wordmate.db'))
    const a = seed('atomicreview')
    const first = scheduler.grade(a.id,2,{expectedReviews:0,requestId:'review-first'})
    check(first.graded, 'review initially grades')
    const duplicate = scheduler.grade(a.id,2,{expectedReviews:0,requestId:'review-first'})
    check(duplicate.replayed && db.getWordById(a.id).reviews===1, 'review retry is idempotent')
    const afterReview = dictation.submit({id:a.id,outcome:'fail',typed:'x',expectedReviews:0,requestId:'dict-after-review'})
    check(!afterReview.graded && db.getWordById(a.id).reviews===1, 'review then dictation does not double grade')
    const b = seed('atomicdictation')
    const payload = {id:b.id,outcome:'first_try',typed:b.word,attempts:1,expectedReviews:0,requestId:'dict-first'}
    check(dictation.submit(payload).graded, 'dictation initially grades')
    check(dictation.submit(payload).replayed && connection.prepare('SELECT count(*) n FROM dictation_log WHERE word=?').get(b.word).n===1, 'dictation retry does not duplicate log')
    check(scheduler.grade(b.id,0,{expectedReviews:0,requestId:'stale-review'}).skipped && db.getWordById(b.id).reviews===1, 'dictation then stale review does not double grade')
    const c=seed('relearning')
    scheduler.grade(c.id,0,{expectedReviews:0,requestId:'fail-first'})
    check(scheduler.grade(c.id,2,{expectedReviews:1,requestId:'early'}).skipped, 'relearning cannot be graded early')
    connection.prepare('UPDATE words SET due_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),c.id)
    check(scheduler.grade(c.id,2,{expectedReviews:1,requestId:'due'}).graded, 'due relearning remains possible on same day')
    const d=seed('rollback')
    const update=db.updateSchedule
    db.updateSchedule=()=>{throw new Error('simulated write failure')}
    assert.throws(()=>dictation.submit({id:d.id,outcome:'fail',requestId:'rollback'}),/simulated/)
    db.updateSchedule=update
    check(connection.prepare('SELECT count(*) n FROM dictation_log WHERE word=?').get(d.word).n===0 && db.getWordById(d.id).reviews===0, 'failed transaction rolls back log and score')
    check(dictation.submit({id:d.id,outcome:'first_try',requestId:'rollback'}).graded, 'same submission can retry after rollback')
    const e=seed('practiceonly')
    check(!dictation.submit({id:e.id,outcome:'first_try',practice:true,requestId:'practice'}).graded && db.getWordById(e.id).reviews===0, 'free practice never changes schedule')
    check(dictation.buildQueue().cards.some(w=>w.id===e.id), 'free practice does not consume regular queue')
    const snapshot=db.getWordById(b.id), deleted=db.removeWord(b.id)
    check(!db.getWordById(b.id) && db.restoreWord(deleted.undoToken).ok, 'delete undo restores word')
    assert.deepEqual(db.getWordById(b.id),snapshot); assertions++; console.log('PASS undo preserves all study fields')
    db.setStatus(e.id,'mastered')
    check(scheduler.grade(e.id,2,{requestId:'mastered'}).skipped, 'mastered word cannot be graded')
    db.setStatus(e.id,'learning')
    check(dictation.buildQueue(true).cards.some(w=>w.id===e.id), 'relearn restores eligibility')
    assert.throws(()=>db.saveSettings({dictationCount:201}),/0–200/);assertions++
    assert.throws(()=>db.updateWord(e.id,{definitions:'[]'}),/释义/);assertions++

    // 清空测试卡片，再通过实际 preload / IPC 验证界面交互。
    connection.exec('DELETE FROM words; DELETE FROM dictation_log')
    const word=seed('interactions'), second=seed('othercard')
    const notebook=await page('notebook')
    await until(()=>notebook.run('allWords.length === 2'), 'notebook ready')
    await notebook.run(`openEditor(${word.id}); document.getElementById('edit-definitions').value='v. | 已修改释义'; document.getElementById('edit-context').value='A saved context.'; document.getElementById('edit-save').click(); true`)
    await until(()=>db.getWordById(word.id).context==='A saved context.', 'edit persisted')
    check(JSON.parse(db.getWordById(word.id).definitions)[0].meaning==='已修改释义','notebook editor saves through IPC')
    const review=await page('review')
    await until(()=>review.run('!!current()'),'review ready')
    const reviewedId=await review.run('current().id')
    await notebook.run(`wm.setStatus(${reviewedId},'mastered')`)
    await until(()=>review.run(`current()?.id !== ${reviewedId}`),'review removed mastered card')
    check(await review.run(`current()?.id !== ${reviewedId}`),'live review removes mastered current card')
    await notebook.run(`wm.setStatus(${reviewedId},'learning')`)
    const dict=await page('dictation')
    await until(()=>dict.run('!!current()'),'dictation ready')
    const dictId=await dict.run('current().id')
    await notebook.run(`wm.removeWord(${dictId})`)
    await until(()=>dict.run(`current()?.id !== ${dictId}`),'dictation removed deleted card')
    check(await dict.run(`current()?.id !== ${dictId}`),'live dictation removes deleted current card')
    await notebook.run(`(async () => { const response = await wm.removeWord(${second.id}); if(response.undoToken) { undo={token:response.undoToken,word:response.word}; showUndo(); } return true })()`)
    // 至少一个已删除单词可以通过撤销重新恢复，验证按钮事件。
    const item=connection.prepare('SELECT token,row_json FROM deleted_words ORDER BY rowid DESC LIMIT 1').get()
    await notebook.run(`undo={token:${JSON.stringify(item.token)},word:'恢复'}; showUndo(); document.getElementById('undo').click(); true`)
    const restoreId=JSON.parse(item.row_json).id
    await until(()=>!!db.getWordById(restoreId),'UI undo')
    check(!!db.getWordById(restoreId),'undo button restores deleted word')

    // 注入保存失败，测试输入和结果保留、重试后只统计一次。
    const remaining=seed('retryanswer')
    const originalSubmit=dictation.submit
    let failOnce=true
    dictation.submit=payload=>{if(failOnce){failOnce=false;throw new Error('simulated IPC failure')}return originalSubmit(payload)}
    await dict.run('start(true)')
    await until(()=>dict.run('!!current()'),'practice ready')
    await dict.run("document.getElementById('ans').value=current().word; check(false); true")
    await until(()=>dict.run("phase === 'save_failed'"),'save error visible')
    check(await dict.run("!!document.getElementById('retry-save') && stats.first===0"),'failed save does not advance or count result')
    await dict.run("document.getElementById('retry-save').click(); true")
    await until(()=>dict.run("phase === 'answered'"),'save retried')
    check(await dict.run('stats.first===1'),'retry records result exactly once')
    dictation.submit=originalSubmit
    const settings=await page('settings')
    await until(()=>settings.run("document.getElementById('model').value !== ''"),'settings ready')
    await settings.run("document.getElementById('dictationCount').value='201'; document.getElementById('save').click(); true")
    await until(()=>settings.run("document.getElementById('msg').textContent.includes('0–200')"),'invalid settings error')
    check(await settings.run("!document.getElementById('save').disabled"),'settings error restores save button')
    await settings.run("document.getElementById('dictationCount').value='10'; load()")
    await notebook.run("wm.openWindow('settings')")
    await until(()=>settings.run("document.getElementById('back-button').textContent.includes('生词本')"),'return destination')
    check(await settings.run("document.getElementById('back-button').textContent.includes('生词本')"),'settings shows explicit return to originating notebook')
    await settings.run("document.getElementById('back-button').click(); true")
    await until(()=>notebook.win.isVisible() && !settings.win.isVisible(),'back returns')
    check(notebook.win.isVisible() && !settings.win.isVisible(),'settings back returns to notebook and hides settings')
    await notebook.run("wm.openWindow('settings')")
    await settings.run("document.getElementById('model').value='unsaved-model'; document.getElementById('back-button').click(); true")
    await until(()=>settings.run("!!document.querySelector('dialog[open]')"),'unsaved dialog')
    await settings.run("document.querySelector('[data-choice=cancel]').click(); true")
    check(await settings.run("document.getElementById('model').value==='unsaved-model'") && settings.win.isVisible(),'cancel return preserves settings draft')
    await settings.run("document.getElementById('back-button').click(); true")
    await until(()=>settings.run("!!document.querySelector('dialog[open]')"),'save-return dialog')
    await settings.run("document.querySelector('[data-choice=save]').click(); true")
    await until(()=>db.getSettings().model==='unsaved-model' && notebook.win.isVisible() && !settings.win.isVisible(),'saved and returned')
    check(db.getSettings().model==='unsaved-model','save and return persists draft before navigating')
    await notebook.run("wm.openWindow('settings')")
    await settings.run("document.getElementById('model').value='discard-me'; document.getElementById('back-button').click(); true")
    await until(()=>settings.run("!!document.querySelector('dialog[open]')"),'discard-return dialog')
    await settings.run("document.querySelector('[data-choice=discard]').click(); true")
    await until(()=>!settings.win.isVisible(),'discard and return')
    check(db.getSettings().model==='unsaved-model','discard return does not persist unsaved settings')
    await notebook.run("wm.openWindow('settings')")
    check(await settings.run("document.getElementById('model').value==='unsaved-model'"),'discarded draft reloads saved values')
        async function browserRpc(message) {
      return new Promise((resolve,reject) => {
        const client=require('net').createConnection(path.join(process.env.WM_USER_DATA,'browser.sock'))
        let data=''
        client.setEncoding('utf8');client.on('error',reject)
        client.on('connect',()=>{
          const raw=Buffer.from(JSON.stringify(message)+'\n')
          client.write(raw.subarray(0,raw.length-3));client.write(raw.subarray(raw.length-3))
        })
        client.on('data',chunk=>data+=chunk)
        client.on('end',()=>{try{resolve(JSON.parse(data))}catch(error){reject(error)}})
      })
    }
    const pageAi=require('../src/ai')
    const originalPassage=pageAi.translatePassage
    let pageCalls=0
    pageAi.translatePassage=async (text,target)=>{pageCalls++;return {type:'sentence',translation:target+':'+text}}
    db.saveSettings({apiKey:'isolated-mock'})
    const wordCount=db.listWords().length
    const paragraph='网页 translation 无损传输'
    const pageResult=await browserRpc({action:'page',text:paragraph,target:'zh'})
    check(pageResult.ok && pageResult.result.translation==='zh:'+paragraph,'local browser bridge returns UTF-8 page translation')
    await browserRpc({action:'page',text:paragraph,target:'zh'})
    await browserRpc({action:'page',text:paragraph,target:'en'})
    check(pageCalls===2,'page cache includes target language')
    check(db.listWords().length===wordCount,'page translation never adds text to notebook')
    check(!(await browserRpc({action:'invalid',text:'test'})).ok,'browser bridge rejects invalid commands')
    pageAi.translatePassage=originalPassage
        const ai=require('../src/ai'), translator=require('../src/translator')
    const originalTranslate=ai.translate
    db.saveSettings({apiKey:'isolated-mock',autoAdd:false})
    ai.translate=async text=>{ if(text==='slowresponse')await new Promise(resolve=>setTimeout(resolve,150)); return {type:'word',word:text,definitions:[{pos:'n.',meaning:'查词回归'}]} }
    const lookup=await page('lookup')
    await lookup.run("document.getElementById('word').value='navigationword'; doLookup()")
    await lookup.run("document.querySelector('[data-open=settings]').click(); true")
    await until(()=>settings.win.isVisible(),'lookup to settings')
    check(await settings.run("document.getElementById('back-button').textContent.includes('查词')"),'lookup to settings displays return to lookup')
    await settings.run("document.getElementById('back-button').click(); true")
    await until(()=>lookup.win.isVisible() && !settings.win.isVisible(),'return lookup')
    check(await lookup.run("current.word==='navigationword' && document.getElementById('word').value==='navigationword'"),'return retains query input and result')
    const originalAdd=translator.addToNotebook
    translator.addToNotebook=payload=>new Promise(resolve=>setTimeout(()=>resolve(originalAdd(payload)),150))
    await lookup.run("document.getElementById('addBtn').click(); document.getElementById('word').value='newresult'; doLookup(); true")
    await until(()=>lookup.run("current?.word==='newresult'"),'new result')
    await until(()=>db.hasWord('navigationword'),'delayed manual add')
    check(await lookup.run("current.word==='newresult' && !current.inNotebook"),'delayed add cannot mark another query as collected')
    translator.addToNotebook=originalAdd
    await lookup.run("document.getElementById('word').value='slowresponse'; doLookup(); document.getElementById('clear').click(); true")
    await new Promise(resolve=>setTimeout(resolve,200))
    check(await lookup.run("current===null && document.getElementById('word').value==='' && document.getElementById('loading').hidden"),'clear prevents late query result from returning')
    ai.translate=originalTranslate
        for(const p of [notebook,review,dict,settings,lookup]) check(p.errors.length===0,'renderer console has no uncaught error')
    fs.mkdirSync(path.join(__dirname,'../test-artifacts'),{recursive:true})
    await notebook.run(`openEditor(${restoreId}); true`)
    for(const [name,p] of [['notebook-editor',notebook],['dictation-retry',dict],['settings',settings]]) {
      const image=await p.win.webContents.capturePage()
      fs.writeFileSync(path.join(__dirname,'../test-artifacts',name+'.png'),image.toPNG())
    }
    console.log(`INTEGRATION_OK assertions=${assertions} isolatedData=${process.env.WM_USER_DATA}`)
    connection.close(); app.exit(0)
  } catch(error) { console.error('INTEGRATION_FAILED',error.stack); if(connection)connection.close();app.exit(1) }
})
