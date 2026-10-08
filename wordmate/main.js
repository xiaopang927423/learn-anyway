// ============================================================
// WordMate 主进程（main process）
// 职责：菜单栏托盘、窗口管理、IPC 接口、复习提醒、数据导出
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, dialog, globalShortcut, clipboard, powerMonitor, shell } = require('electron')
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const db = require('./src/db')
const ai = require('./src/ai')
const translator = require('./src/translator')
const scheduler = require('./src/scheduler')
const dictation = require('./src/dictation')

// 让 userData 目录落在 ~/Library/Application Support/WordMate（而不是 Electron）
app.setName('WordMate')
// 测试用：WM_USER_DATA=路径 可隔离数据目录（独立单实例锁，互不干扰）
if (process.env.WM_USER_DATA) app.setPath('userData', process.env.WM_USER_DATA)
// 菜单栏应用：不显示 Dock 图标
app.dock.hide()

// 主进程任何未捕获异常都打印到终端（npm start 可见），避免"静默退出"
process.on('uncaughtException', (err) => {
  console.error('[WordMate 崩溃]', err)
})

// 单实例锁：防止重复启动
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  return
} else {
  // 再次启动时（比如又跑了一次 npm start），聚焦已有查词窗而不是静默忽略
  app.on('second-instance', (event, argv) => {
    const url = argv.find(x => x.startsWith('wordmate://'))
    if (url) handleTranslateUrl(url)
    else open('lookup')
  })
}

let pendingTranslateUrl = null
function handleTranslateUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'wordmate:' || url.hostname !== 'translate') return
    const text = url.searchParams.get('text') || ''
    if (text.length > 12000) return
    if (!db.ready()) pendingTranslateUrl = value
    else sendToLookup(text)
  } catch {}
}
app.on('open-url', (event, url) => { event.preventDefault(); handleTranslateUrl(url) })

// ---------------- 窗口管理 ----------------
const windows = {}
const navigation = {}
let quitting = false
app.on('before-quit', () => { quitting = true })
function nameFor(sender) { return Object.keys(windows).find(name => windows[name]?.webContents === sender) }
function navigationFor(name) {
  const labels = { lookup: '查词', notebook: '生词本', review: '复习', dictation: '默写', settings: '设置' }
  const previous = navigation[name]?.at(-1) || 'lookup'
  return { name, previous, label: labels[previous], canGoBack: !!navigation[name]?.length }
}
function goBack(name) {
  if (!name || name === 'lookup' && !navigation[name]?.length) { windows[name]?.hide(); return true }
  const history = navigation[name]?.slice() || ['lookup']
  const previous = history.pop() || 'lookup'
  navigation[previous] = history
  windows[name]?.hide()
  open(previous)
  return true
}
const resourceRoot = app.isPackaged ? process.resourcesPath : __dirname
const integration = { services: false, shortcuts: {}, browser: false }
function changed(type, id) {
  updateBadge()
  setImmediate(() => {
    for (const win of Object.values(windows)) if (!win.isDestroyed()) win.webContents.send('data:changed', { type, id })
  })
}

function createWindow(name, opts) {
  // 已存在则直接显示并聚焦
  if (windows[name] && !windows[name].isDestroyed()) {
    windows[name].show()
    windows[name].focus()
    // 复习/默写窗复用时通知刷新队列（否则期间新加的词看不到）
    if (name === 'review' || name === 'dictation') windows[name].webContents.send(`${name}:refresh`)
    return windows[name]
  }
  const win = new BrowserWindow({
    width: opts.width || 420,
    height: opts.height || 580,
    show: false,
    alwaysOnTop: !!opts.alwaysOnTop,
    skipTaskbar: true,
    fullscreenable: false,
    title: 'WordMate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.loadFile(path.join(__dirname, opts.file))
  win.on('close', event => { if (!quitting) { event.preventDefault(); goBack(name) } })
  win.once('ready-to-show', () => { win.show(); win.focus() })
  // 注：不做"失焦自动隐藏"——对新手太反直觉；用 Esc 或再点托盘图标收起
  windows[name] = win
  return win
}

// 窗口配置表：name -> [html 文件, 宽, 高]
const WINDOW_DEFS = {
  lookup:   ['renderer/lookup.html',   420, 600, true],
  notebook: ['renderer/notebook.html', 540, 660, false],
  review:   ['renderer/review.html',   500, 640, false],
  dictation: ['renderer/dictation.html', 500, 640, false],
  settings: ['renderer/settings.html', 480, 560, false],
}

function open(name, origin = null) {
  const practice = name === 'dictationPractice'
  if (practice) name = 'dictation'
  // 打开其它窗口时先收起置顶的查词窗——否则它会永远挡在前面
  if (name !== 'lookup' && windows.lookup && !windows.lookup.isDestroyed() && windows.lookup.isVisible()) {
    windows.lookup.hide()
  }
  if (!Object.hasOwn(WINDOW_DEFS, name)) throw new Error('未知窗口')
  if (origin && origin !== name) {
    const history = [...(navigation[origin] || []), origin]
    const existing = history.indexOf(name)
    navigation[name] = existing >= 0 ? history.slice(0, existing) : history
    windows[origin]?.hide()
  } else if (!navigation[name]) navigation[name] = name === 'lookup' ? [] : ['lookup']
  const [file, w, h, top] = WINDOW_DEFS[name]
  if (practice && windows.dictation && !windows.dictation.isDestroyed()) {
    windows.dictation.webContents.send('dictation:practice')
    windows.dictation.show(); windows.dictation.focus(); windows.dictation.webContents.send('navigation:changed', navigationFor(name)); return windows.dictation
  }
  const win = createWindow(name, { file, width: w, height: h, alwaysOnTop: top })
  if (!win.webContents.isLoading()) win.webContents.send('navigation:changed', navigationFor(name))
  if (practice) win.webContents.once('did-finish-load', () => win.webContents.send('dictation:practice'))
  return win
}

function toggleLookup() {
  const exists = windows.lookup && !windows.lookup.isDestroyed()
  // 已显示则收起；否则弹出
  if (exists && windows.lookup.isVisible()) {
    windows.lookup.hide()
    return
  }
  open('lookup')
}

// ---------------- 划词查词（⌥D） ----------------
// 流程：模拟 ⌘C 复制当前选中的词 → 读剪贴板 → 提取英文单词 → 查词窗展示并自动入生词本
// 模拟 ⌘C 需要"辅助功能"权限；失败时提示用户授权并放弃本次划词——
// 不能再直接读剪贴板，否则拿到的是上次复制的旧内容，会查错词。
let selecting = false
function grabSelection(cb) {
  if (selecting) return
  selecting = true
  let native
  const fail = message => {
    selecting = false
    new Notification({ title: 'WordMate 划词失败', body: message }).show()
    cb(null)
  }
  try {
    native = require('wordmate-services')
    const selected = native.selectedText().trim()
    if (selected) { selecting = false; cb(selected); return }
    native.beginCapture()
  } catch (error) { fail(error.message + '；也可使用右键服务或浏览器翻译'); return }
  execFile('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'], { timeout: 3000 }, error => {
    setTimeout(() => {
      let text
      try { text = native.endCapture().trim() }
      catch (failure) { fail(failure.message); return }
      selecting = false
      if (error || !text) { fail(error ? '请在设置中打开辅助功能授权，或使用右键翻译。' : '未读取到选区或剪贴板发生并发变化，请重新选中后再试。'); return }
      cb(text)
    }, 200)
  })
}

// 打开查词窗并把一段文本送进去查（等页面加载完再发，否则早期 send 会被丢掉）。
// ⌥D 划词和右键服务菜单共用这条管线：单个英文词→查词并（设置允许时）自动入生词本；
// 句子/中文→整句翻译。
let selectionDeliverySeq = 0
function sendToLookup(text) {
  const t = String(text || '').trim()
  if (!t) return
  if (t.length > 12000) { new Notification({ title: 'WordMate', body: '选中文本超过 12000 字符，请缩短选区' }).show(); return }
  const win = open('lookup')
  const seq = ++selectionDeliverySeq
  const deliver = () => { if (seq === selectionDeliverySeq && !win.isDestroyed()) win.webContents.send('lookup:prefill', t) }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', deliver)
  else deliver()
}

function lookupFromSelection() {
  grabSelection((text) => {
    if (!text) return // 模拟 ⌘C 失败（已提示授权），不查剪贴板旧内容
    sendToLookup(text)
  })
}

// ---------------- macOS 服务菜单（选中文字 → 右键 →「服务」→「用 WordMate 翻译」） ----------------
// 原生插件 wordmate-services 把系统「服务」菜单命中的选中文本回传过来，交给 sendToLookup。
// 与 ⌥D 的区别：这里直接拿到选区文本，无需模拟 ⌘C，且整句/中文选区也能就地翻译。
function startMacServices() {
  if (process.platform !== 'darwin') return
  let svc = null
  try {
    svc = require('wordmate-services')
  } catch (e) {
    // 未编译（开发模式）或未打包时属正常，不影响其它功能
    console.log('[WordMate] 右键翻译服务未启用（原生插件未编译？）:', e.message)
    return
  }
  try {
    svc.init((text) => {
      const t = String(text || '').trim()
      if (!t) return
      sendToLookup(t)
    })
    integration.services = app.isPackaged
    console.log('[WordMate] 已注册 macOS 服务菜单：选中文字 → 右键 →「服务」→「用 WordMate 翻译」')
  } catch (e) {
    console.error('[WordMate] 服务菜单注册失败:', e.message)
  }
}

// ---------------- 菜单栏托盘 ----------------
let tray = null

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'tray-icon.png')
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) console.warn('[WordMate] 托盘图标加载失败: ' + p)
  img.setTemplateImage(true) // 黑色剪影，自动适配深色/浅色菜单栏
  return img
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('WordMate')
  tray.on('click', toggleLookup)
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: '查词', click: toggleLookup },
      { label: '生词本', click: () => open('notebook') },
      { label: '开始复习', click: () => open('review') },
      { label: '默写一组', click: () => open('dictation') },
      { label: '设置', click: () => open('settings') },
      { type: 'separator' },
      { label: '退出 WordMate', click: () => app.quit() },
    ]))
  })
}

// 托盘角标：显示今日待复习数
function updateBadge() {
  if (!tray) return
  const n = scheduler.pendingCount()
  tray.setTitle(n > 0 ? ` ${n}` : '')
}

// ---------------- IPC 接口（渲染进程可调用的 API） ----------------
function registerIpc() {
  ipcMain.handle('lookup:query', async (e, word, context) => {
    const result = await translator.lookup(word, context)
    changed('lookup')
    return result
  })
  ipcMain.handle('notebook:add', (e, payload) => {
    const r = translator.addToNotebook(payload)
    changed('learning')
    return r
  })
  ipcMain.handle('notebook:list', () => db.listWords())
  ipcMain.handle('notebook:has', (e, words) => db.hasWords(words))
  ipcMain.handle('notebook:remove', (e, idOrWord) => {
    const result = db.removeWord(idOrWord)
    changed('remove', result.id)
    return result
  })
  ipcMain.handle('notebook:restore', (e, token) => { const result = db.restoreWord(token); changed('restore', result.id); return result })
  ipcMain.handle('notebook:update', (e, id, patch) => { const result = db.updateWord(id, patch); changed('edit', id); return result })
  ipcMain.handle('notebook:setStatus', (e, id, status) => {
    db.setStatus(id, status)
    changed('status', id)
    return true
  })

  ipcMain.handle('review:queue', () => scheduler.getQueue())
  ipcMain.handle('review:grade', (e, id, grade, options) => {
    const r = scheduler.grade(id, grade, { expectedReviews: options?.expectedReviews, requestId: options?.requestId })
    changed('learning')
    return r
  })
  ipcMain.handle('review:pending', () => scheduler.pendingCount())

  ipcMain.handle('dictation:queue', (e, practice) => dictation.buildQueue(practice === true))
  ipcMain.handle('dictation:submit', (e, payload) => {
    const r = dictation.submit(payload)
    changed('learning', payload?.id)
    return r
  })

  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:set', (e, patch) => { const result = db.saveSettings(patch); changed('settings'); return result })
  ipcMain.handle('app:installBrowser', async () => {
    try {
      await new Promise((resolve, reject) => execFile('/usr/bin/python3', [path.join(resourceRoot, 'scripts', 'install-browser-host.py')], { timeout: 10000 }, error => error ? reject(error) : resolve()))
      integration.browser = true
      return { ok: true }
    } catch (error) { return { ok: false, error: '浏览器连接安装失败：' + error.message } }
  })
  ipcMain.handle('app:integration', () => ({ ...integration, extensionPath: path.join(resourceRoot, 'browser-extension'), appPath: app.getPath('exe') }))
  ipcMain.handle('app:browserFolder', () => { shell.showItemInFolder(path.join(resourceRoot, 'browser-extension', 'manifest.json')); return true })
  ipcMain.handle('app:accessibility', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'))
  ipcMain.handle('settings:export', exportCSV)
  ipcMain.handle('settings:importDiffu', async () => {
    const choice = await dialog.showOpenDialog({ title: '选择 package 3 的 config/models.json', properties: ['openFile'], filters: [{ name: '模型配置', extensions: ['json'] }] })
    if (choice.canceled) return { canceled: true }
    try { return { ok: true, settings: db.saveSettings(require('./src/providers').readDiffu(choice.filePaths[0])) } }
    catch (error) { return { ok: false, error: error.message } }
  })
  // 测试连接：用表单里当前填的值（未保存也能测）
  ipcMain.handle('settings:test', async (e, patch) => {
    try {
      return await ai.ping(patch || {})
    } catch (err) {
      return { ok: false, error: /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT/i.test(err.message)
        ? '网络不通或接口地址无法访问：' + err.message
        : err.message }
    }
  })

  ipcMain.handle('app:copy', (e, text) => { if (typeof text !== 'string' || text.length > 50000) throw new Error('复制内容无效'); clipboard.writeText(text); return true })
  ipcMain.handle('app:navigation', e => navigationFor(nameFor(e.sender)))
  ipcMain.handle('app:back', e => goBack(nameFor(e.sender)))
  ipcMain.handle('app:open', (e, name) => { open(name, nameFor(e.sender)); return true })
}

// ---------------- 导出 CSV ----------------
async function exportCSV() {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出生词本',
    defaultPath: 'wordmate-export.csv',
  })
  if (canceled || !filePath) return { saved: false }
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const lines = ['word,phonetic,forms,memory_tip,linked_words,definitions,examples,context,status,created_at']
  for (const w of db.listWords()) {
    lines.push([w.word, w.phonetic, w.forms, w.memory_tip, w.linked_words, w.definitions, w.examples, w.context, w.status, w.created_at].map(esc).join(','))
  }
  fs.writeFileSync(filePath, '\ufeff' + lines.join('\n')) // BOM 让 Excel 正确识别中文
  return { saved: true, filePath }
}

// ---------------- 每日复习提醒 ----------------
function maintenance(now = new Date()) {
  if (!db.ready()) return
  updateBadge()
  const settings = db.getSettings()
  const today = db.localIso(now).slice(0, 10)
  const hhmm = db.localIso(now).slice(11, 16)
  // 用本地设置持久化当天通知状态，重启不重复，睡眠唤醒后补发。
  if (settings.notifyEnabled && hhmm >= settings.remindTime && settings.lastNotifiedDate !== today) {
    const n = scheduler.pendingCount()
    if (n > 0) {
      const notification = new Notification({ title: 'WordMate', body: `你有 ${n} 个单词待复习，点击开始` })
      notification.on('click', () => open('review'))
      notification.show()
      db.saveSettings({ lastNotifiedDate: today })
    }
  }
}
setInterval(maintenance, 30000)

// ---------------- 启动 ----------------
app.whenReady().then(() => {
  db.init()
  const importIndex = process.argv.indexOf('--import-diffu')
  if (importIndex >= 0 && process.argv[importIndex + 1]) {
    db.saveSettings(require('./src/providers').readDiffu(process.argv[importIndex + 1]))
    console.log('[WordMate] Diffu 配置已导入（密钥未输出）')
  }
  app.setAsDefaultProtocolClient('wordmate')
  const hostManifest = path.join(app.getPath('appData'), 'Google/Chrome/NativeMessagingHosts/com.qiji.wordmate.json')
  integration.browser = fs.existsSync(hostManifest)
  const browserBridge = require('./src/browser-bridge').startBrowserBridge(app.getPath('userData'), changed)
  app.on('will-quit', () => browserBridge.close())
  registerIpc()
  createTray()
  if (!process.env.WM_TEST_SUITE) startMacServices()
  if (pendingTranslateUrl) { handleTranslateUrl(pendingTranslateUrl); pendingTranslateUrl = null }

  // 冒烟测试模式：WM_SMOKE=1 时启动后自检并退出（用于自动化验证）
  if (process.env.WM_SMOKE) {
    if (!process.env.WM_USER_DATA) throw new Error('冒烟测试必须设置 WM_USER_DATA 隔离目录')
    const q = scheduler.getQueue()
    console.log(`SMOKE_OK cards=${q.cards.length} pending=${scheduler.pendingCount()} dict=${dictation.buildQueue().cards.length}`)
    // 默写全链路：塞一个测试词 → 入队 → 一次对(应计分) → 同日再交(只记日志不重复计分)
    db.addWord({ word: 'smoketest', definitions: [{ pos: 'v.', meaning: '测试' }],
      examples: [{ en: 'This is a smoketest run.', zh: '这是冒烟测试。' }] }, '', 0)
    const dq = dictation.buildQueue()
    const w0 = dq.cards[0]
    const first = w0 && dictation.submit({ id: w0.id, word: w0.word, outcome: 'first_try', typed: w0.word, attempts: 1 })
    const second = w0 && dictation.submit({ id: w0.id, word: w0.word, outcome: 'fail', typed: 'smokteest', attempts: 2 })
    console.log(`SMOKE_DICT cards=${dq.cards.length} first=${JSON.stringify(first)} second=${JSON.stringify(second)} today=[${db.dictatedToday()}]`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (!process.env.WM_TEST_SUITE) maintenance()
  powerMonitor.on('resume', maintenance)
  // 浏览器按需启动桌面后端时保持浏览器焦点。
  if (!process.argv.includes('--browser-background')) open('lookup')

  // 全局快捷键 ⌥Space（Option+空格）：任何应用里都能呼出/收起查词窗
  const shortcutOk = !process.env.WM_TEST_SUITE && globalShortcut.register('Alt+Space', toggleLookup)
  integration.shortcuts.lookup = shortcutOk
  if (!process.env.WM_TEST_SUITE && !shortcutOk) console.warn('[WordMate] ⌥Space 快捷键注册失败，可能被其它应用占用')
  // 全局快捷键 ⌥D：划词查词（选中单词后按 ⌥D，自动查词并入生词本）
  const shortcutD = !process.env.WM_TEST_SUITE && globalShortcut.register('Alt+D', lookupFromSelection)
  integration.shortcuts.selection = shortcutD
  if (!process.env.WM_TEST_SUITE && !shortcutD) console.warn('[WordMate] ⌥D 快捷键注册失败，可能被其它应用占用')
  app.on('will-quit', () => { globalShortcut.unregisterAll(); try { require('wordmate-services').unregister() } catch {} })
  const failedShortcuts = [!shortcutOk && '⌥Space', !shortcutD && '⌥D'].filter(Boolean)
  if (!process.env.WM_TEST_SUITE && failedShortcuts.length) new Notification({ title: 'WordMate 快捷键被占用', body: failedShortcuts.join('、') + '无法注册，请查看设置；可使用菜单栏或右键翻译。' }).show()

  // 启动提示：告诉用户应用在哪、怎么用
  if (!process.env.WM_TEST_SUITE && !process.argv.includes('--browser-background')) new Notification({
    title: 'WordMate 已启动',
    body: '菜单栏 W 图标或 ⌥Space 呼出查词；选中单词按 ⌥D 划词查词',
  }).show()
  // 诊断模式：WM_WINDOWS=1 时打开全部窗口（自动化测试用）
  if (process.env.WM_WINDOWS) {
    open('notebook'); open('review'); open('settings'); open('dictation')
    // 检查每个窗口的 preload 是否正常注入 window.wm
    setTimeout(() => {
      for (const [name, w] of Object.entries(windows)) {
        if (w.isDestroyed()) continue
        w.webContents.executeJavaScript('typeof window.wm + " @ " + location.pathname')
          .then((r) => console.log('[diag]', name, r))
          .catch((e) => console.log('[diag]', name, 'ERR', e.message))
      }
    }, 2500)
  }

  // 截图模式：WM_SHOTS=目录 依次预演「查词 → 翻面 → 句子拆分 → 点词入本」，各窗口存 PNG 后退出（视觉自检用）
  if (process.env.WM_SHOTS) {
    const SENTENCE = 'The board wants to leverage our resilience and streamline the workflow despite a few hiccups.'
    const dir = process.env.WM_SHOTS
    open('notebook'); open('review'); open('settings')
    const shot = async (w, file) => {
      if (!w || w.isDestroyed()) return
      try {
        const img = await w.webContents.capturePage()
        fs.writeFileSync(path.join(dir, file), img.toPNG())
        console.log('[shots]', file, 'saved')
      } catch (e) { console.log('[shots]', file, 'ERR', e.message) }
    }
    const runJs = (w, code) => { if (w && !w.isDestroyed()) w.webContents.executeJavaScript(code).catch(() => {}) }
    setTimeout(() => {
      runJs(windows.lookup, `document.getElementById('word').value='estimate'; doLookup(); 'ok'`)
      runJs(windows.review, 'flip(); "ok"')
    }, 900)
    setTimeout(async () => {
      await shot(windows.lookup, 'lookup.png')
      for (const [name, w] of Object.entries(windows)) {
        if (name !== 'lookup') await shot(w, name + '.png')
      }
      // 阶段 2：整句翻译 + 单词拆分
      runJs(windows.lookup, `document.getElementById('word').value='${SENTENCE}'; doLookup(); 'ok'`)
      await new Promise((r) => setTimeout(r, 1100))
      await shot(windows.lookup, 'lookup-sentence.png')
      // 阶段 3：模拟点击 streamline 点词入本
      runJs(windows.lookup, `
        const el = document.querySelector('[data-w="streamline"]');
        if (el) el.click();
        'clicked'`)
      await new Promise((r) => setTimeout(r, 900))
      await shot(windows.lookup, 'lookup-added.png')
      // 阶段 4：生词本点击单词行 → 展开单词卡片
      runJs(windows.notebook, `document.querySelector('.word-item .main-row').click(); 'ok'`)
      await new Promise((r) => setTimeout(r, 500))
      await shot(windows.notebook, 'notebook-expanded.png')
      // 阶段 5：查词卡展示词形变化（复数/比较级/派生词等）
      runJs(windows.lookup, `document.getElementById('word').value='good'; doLookup(); 'ok'`)
      await new Promise((r) => setTimeout(r, 900))
      await shot(windows.lookup, 'lookup-forms.png')
      app.quit()
    }, 2600)
  }

  // 点击测试：WM_CLICKTEST=1 时模拟点击查词窗的"设置"链接，验证导航是否生效
  if (process.env.WM_CLICKTEST) {
    setTimeout(() => {
      const lw = windows.lookup
      if (!lw || lw.isDestroyed()) { console.log('[clicktest] lookup missing'); return }
      lw.webContents.executeJavaScript(
        "document.querySelector('[data-open=\"settings\"]').click(); 'ok'"
      ).then(() => setTimeout(() => {
        const ok = windows.settings && !windows.settings.isDestroyed() && windows.settings.isVisible()
        const lookupHidden = !windows.lookup || windows.lookup.isDestroyed() || !windows.lookup.isVisible()
        console.log('[clicktest] settings window:', ok ? 'OPEN' : 'MISSING',
          '| lookup hidden:', lookupHidden ? 'YES' : 'NO')
        app.quit()
      }, 1200))
    }, 2000)
  }
})

// 菜单栏应用：所有窗口关闭后仍保持运行
app.on('window-all-closed', () => {})

module.exports = { open, windows, maintenance, integration, changed, handleTranslateUrl }
