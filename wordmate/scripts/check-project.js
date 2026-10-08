const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const appRoot = path.resolve(__dirname, '..'), root = path.resolve(appRoot, '..')
const skipped = new Set(['node_modules','dist','.git','.claude','build','bin','test-artifacts','__pycache__'])
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item => skipped.has(item.name) ? [] : item.isDirectory() ? files(path.join(dir,item.name)) : [path.join(dir,item.name)]) }
for (const name of ['架构目录','测试目录','产品需求目录']) {
  if (!fs.existsSync(path.join(root,'docs',name,'README.md'))) throw new Error('缺少文档分类入口：' + name)
}
const all = files(root)
for (const file of all) {
  if (file.endsWith('.js')) execFileSync(process.execPath,['--check',file],{stdio:'pipe'})
  if (file.endsWith('.py')) execFileSync('/usr/bin/python3',['-c','import pathlib,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_text(encoding="utf-8"), str(p), "exec")',file],{stdio:'pipe'})
  if (!file.endsWith('.md')) continue
  const text = fs.readFileSync(file,'utf8')
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].split('#')[0].replace(/^<|>$/g,'')
    if (!link || /^(https?:|mailto:|codex:|\/)/.test(link)) continue
    const target = path.resolve(path.dirname(file),decodeURIComponent(link))
    if (!fs.existsSync(target)) throw new Error(`文档链接不存在：${path.relative(root,file)} → ${link}`)
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot,'package.json')))
const extension = JSON.parse(fs.readFileSync(path.join(appRoot,'browser-extension/manifest.json')))
const lock = JSON.parse(fs.readFileSync(path.join(appRoot,'package-lock.json')))
if (pkg.version !== extension.version || pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('应用 / 扩展 / 锁文件版本不一致')
console.log('PROJECT_CHECK_OK syntax, docs, links, versions')
