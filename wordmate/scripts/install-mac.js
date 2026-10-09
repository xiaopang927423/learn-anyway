// 保留实际安装路径，避免升级生成另一个开机时不会使用的副本。
const fs = require('fs'), path = require('path'), os = require('os'), {execFileSync} = require('child_process')
const bundle = path.resolve(__dirname,'../dist/mac-arm64/WordMate.app')
if (!fs.existsSync(bundle)) throw new Error('请先运行 npm run dist')
// Reject stale packages before stopping the daily app: version alone does not
// establish that the paired native input method can connect to this backend.
const asar = require('@electron/asar')
function verifyImePackage(appBundle) {
  const archive = path.join(appBundle, 'Contents/Resources/app.asar')
  if (!asar.extractFile(archive, 'main.js').toString().includes('startImeBridge') ||
      !asar.extractFile(archive, 'renderer/settings.html').toString().includes('id="imeEnabled"')) {
    throw new Error('安装包缺少输入法云辅助服务或设置，请重新运行 npm run dist')
  }
  asar.extractFile(archive, 'src/ime-bridge.js')
}
verifyImePackage(bundle)
const userBundle = path.join(os.homedir(),'Applications/WordMate.app')
const destination = fs.existsSync('/Applications/WordMate.app') ? '/Applications/WordMate.app' : userBundle
const backup = path.join(os.homedir(),'Library/Application Support/WordMate/app-backup/WordMate.app')
const processes = execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n')
for (const line of processes) {
  const match=line.trim().match(/^(\d+)\s+(.+)$/)
  if (match && [destination,userBundle].some(app => match[2].startsWith(app+'/Contents/MacOS/WordMate'))) {
    try { process.kill(Number(match[1]),'SIGTERM') } catch {}
  }
}
if (fs.existsSync(destination)) {
  fs.mkdirSync(path.dirname(backup),{recursive:true})
  execFileSync('/usr/bin/ditto',[destination,backup])
}
fs.mkdirSync(path.dirname(destination),{recursive:true})
execFileSync('/usr/bin/ditto',[bundle,destination])
verifyImePackage(destination)
// 本项目曾安装的用户目录副本同步升级，避免手动打开该副本又回到旧后端。
if (destination !== userBundle && fs.existsSync(userBundle)) execFileSync('/usr/bin/ditto',[bundle,userBundle])
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',destination])
execFileSync('/usr/bin/python3',[path.join(destination,'Contents/Resources/scripts/install-browser-host.py')],{stdio:'inherit'})
execFileSync('/usr/bin/open',['-g',destination,'--args','--browser-background'])
console.log('INSTALLED '+destination+'; BACKUP '+backup)
