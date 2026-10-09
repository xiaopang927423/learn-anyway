// Isolated development backend for real native-input testing; never opens the daily notebook.
const fs=require('fs'),path=require('path'),{app}=require('electron')
const directory=process.env.WM_IME_TEST_DIR
if (!directory || !directory.startsWith('/tmp/wm-ime-')) throw new Error('Use a dedicated /tmp/wm-ime-* test directory')
fs.mkdirSync(directory,{recursive:true,mode:0o700});app.setPath('userData',directory)
const db=require('../src/db')
let server,native
app.whenReady().then(async()=>{
  try {
    db.init()
    db.saveSettings({...require('../src/providers').readDiffu('/Users/qiji/Downloads/package 3/config/models.json'),imeEnabled:true,imeAutoAdd:true,imeSaveContext:false,autoAdd:true,thinkingEnabled:false})
    server=await require('../src/ime-bridge').startImeBridge(directory,db)
    native=require('child_process').spawn(path.join(require('os').homedir(),'Library/Input Methods/WordMateInput.app/Contents/MacOS/WordMateInput'),[],{env:{...process.env,WM_USER_DATA:directory,WM_IME_DATA:path.join(directory,'input-settings')},stdio:'ignore'})
    native.once('exit',code=>console.log('IME_NATIVE_EXIT '+code))
    console.log('IME_TEST_SERVER_READY '+directory)
    process.on('SIGTERM',()=>app.quit())
    app.on('will-quit',()=>{native?.kill();server?.dispose()})
  }catch(error){console.error('IME_TEST_SERVER_FAILED '+(error.code||'startup'));app.exit(1)}
})
