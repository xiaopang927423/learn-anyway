const HOST = 'com.qiji.wordmate'
function nativeTranslate(message) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HOST)
    let complete = false
    const timer = setTimeout(() => finish(new Error('翻译超时，请重试')), 75000)
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
  if (name === 'pdf') return openPdfReader(tabId, target, readingMode)
  if (chrome.tabs.get) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.url?.startsWith(chrome.runtime.getURL('pdf-reader.html'))) {
      return chrome.tabs.sendMessage(tabId, { command: name, text, target, readingMode })
    }
    if (name === 'page' && /\.pdf(?:[?#]|$)/i.test(tab.url || '')) return openPdfReader(tabId, target, readingMode)
  }
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] })
  return chrome.tabs.sendMessage(tabId, { command: name, text, target, readingMode }, { frameId })
}
async function openPdfReader(tabId, target = 'zh', readingMode = 'bilingual', suppliedSource) {
  const tab = await chrome.tabs.get(tabId)
  let source = ''
  try { const url = new URL(suppliedSource || tab.url); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) source = url.href } catch {}
  const params = new URLSearchParams({ target, mode: readingMode || 'bilingual', inline: '1' })
  if (source) { params.set('source', source); params.set('autoload', '1') }
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL('pdf-reader.html') + '?' + params })
  return { ok: true }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'translate', title: 'WordMate：翻译选中文本', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'page', title: 'WordMate：翻译页面内容', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'restore', title: 'WordMate：恢复页面原文', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'pdf', title: 'WordMate：当前 PDF 双语对照', contexts: ['page', 'link'] })
  })
})
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !['translate', 'page', 'restore', 'pdf'].includes(info.menuItemId)) return
  try {
    const pdfSource = info.menuItemId === 'pdf' ? (info.linkUrl || tab.url) : info.menuItemId === 'page' && /\.pdf(?:[?#]|$)/i.test(tab.url || '') ? tab.url : null
    if (pdfSource && /^https?:\/\//i.test(pdfSource)) {
      const origin = new URL(pdfSource).origin + '/*'
      // The context-menu click is the user gesture, before navigating away from activeTab.
      if (chrome.permissions && !await chrome.permissions.contains({ origins: [origin] })) await chrome.permissions.request({ origins: [origin] })
    }
    if (info.menuItemId === 'pdf' && info.linkUrl) {
      const url = new URL(info.linkUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('不支持此 PDF 地址')
      await openPdfReader(tab.id, 'zh', 'bilingual', url.href)
    } else await command(tab.id, info.menuItemId === 'translate' ? 'selection' : info.menuItemId, info.selectionText || '', 'zh', info.menuItemId === 'translate' ? (info.frameId || 0) : 0)
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' })
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' })
    await chrome.action.setTitle({ tabId: tab.id, title: '该页面无法注入翻译；PDF 请点击扩展中的当前 PDF 双语对照' })
  }
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const reader = sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL?.('pdf-reader.html')
  if (message?.type === 'translate-text' && (sender.tab || reader)) {
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
      .then(result => respond(result), error => respond({ ok: false, error: '该页面不能直接翻译；PDF 请使用“PDF 双语阅读器”，本地文件可在阅读器中打开。' }))
    return true
  }
  return false
})
