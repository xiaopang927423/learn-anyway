// Real SQLite in Electron, isolated from the user's notebook.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict')
process.env.WM_USER_DATA=fs.mkdtempSync(path.join(os.tmpdir(),'wm-ime-learning-'))
const {app}=require('electron')
app.setPath('userData',process.env.WM_USER_DATA)
const db=require('../src/db'),{commitLearning}=require('../src/ime-learning')
app.whenReady().then(()=>{
  try {
    db.init();db.saveSettings({autoAdd:true,imeAutoAdd:true,imeSaveContext:false})
    const p={commitId:'commit-test-001',confirmed:true,adoptedExpression:'breakfast',sourceMeaning:'早饭',origin:'fragment',context:'we want to eat breakfast'}
    const first=commitLearning(p,db);assert.ok(first.saved)
    assert.equal(db.getWordById(first.id).context,'');assert.equal(db.getWordById(first.id).lookup_count,0)
    assert.equal(db.imeUsage(first.id),1)
    assert.ok(commitLearning(p,db).replayed);assert.equal(db.imeUsage(first.id),1)
    assert.throws(()=>commitLearning({...p,adoptedExpression:'lunch'},db),/冲突/)
    db.setStatus(first.id,'mastered');const before=db.getWordById(first.id)
    commitLearning({...p,commitId:'commit-test-002'},db)
    assert.deepEqual(db.getWordById(first.id),before);assert.equal(db.imeUsage(first.id),2)
    db.saveSettings({autoAdd:false});assert.ok(commitLearning({...p,commitId:'commit-test-003'},db).skipped)
    db.saveSettings({autoAdd:true,imeAutoAdd:false});assert.ok(commitLearning({...p,commitId:'commit-test-004'},db).skipped)
    const manual=commitLearning({...p,commitId:'commit-test-005',origin:'manual',manual:true,adoptedExpression:'as soon as possible',sourceMeaning:'尽快'},db)
    assert.ok(manual.saved);assert.equal(db.listWords().length,2)
    console.log('IME_LEARNING_OK confirmed-only, deduplication, conflict, mastered, switches, privacy, expressions')
    app.exit(0)
  }catch(e){console.error(e);app.exit(1)}
})
