const HOST = 'com.qiji.wordmate'
function nativeTranslate(message) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HOST)
    let complete = false
    const timer = setTimeout(() => finish(new Error('翻译超时，请重试')), 60000)
    function finish(error, result) {
      if (complete) return
      complete = true; clearTimeout(timer); port.disconnect()
      if (error) reject(error); else resolve(result)
    }
    port.onMessage.addListener(response => {
      if (!response?.ok) finish(new Error(response?.error || '无法连接 WordMate'))
      else finish(null, response.result)
    })
    port.onDisconnect.addListener(() => { if (!complete) finish(new Error(chrome.runtime.lastError?.message || '本机连接已断开，请安装新版 WordMate 连接')) })
    port.postMessage(message)
  })
}
async function command(tabId, name, text = '', target = 'zh', frameId = 0, readingMode) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] })
  return chrome.tabs.sendMessage(tabId, { command: name, text, target, readingMode }, { frameId })
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'translate', title: 'WordMate：翻译选中文本', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'page', title: 'WordMate：翻译整个页面', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'restore', title: 'WordMate：恢复页面原文', contexts: ['page'] })
  })
})
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !['translate', 'page', 'restore'].includes(info.menuItemId)) return
  try {
    await command(tab.id, info.menuItemId === 'translate' ? 'selection' : info.menuItemId, info.selectionText || '', 'zh', info.menuItemId === 'translate' ? (info.frameId || 0) : 0)
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' })
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' })
    await chrome.action.setTitle({ tabId: tab.id, title: '该页面无法注入翻译，请在普通网页使用；也可点击扩展查看帮助' })
  }
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'translate-text' && sender.tab) {
    nativeTranslate({ action: message.action, text: message.text, context: message.context || '', target: message.target || 'zh', segments: message.segments })
      .then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }))
    return true
  }
  if (message?.type === 'preferences' && !sender.tab) {
    nativeTranslate({ action: message.thinkingEnabled == null ? 'get-preferences' : 'set-preferences', thinkingEnabled: message.thinkingEnabled })
      .then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }))
    return true
  }
  if (message?.type === 'command' && !sender.tab) {
    command(message.tabId, message.command, '', message.target || 'zh', 0, message.readingMode)
      .then(result => respond(result), error => respond({ ok: false, error: '该页面不能翻译（浏览器内置页、扩展商店和部分 PDF 不允许注入）。' }))
    return true
  }
  return false
})
