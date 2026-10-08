// ============================================================
// preload 脚本：安全地暴露给界面（渲染进程）的 API
// 界面里通过 window.wm.xxx() 调用，无法直接访问 Node.js
// ============================================================
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wm', {
  // 查词
  lookup: (word, context) => ipcRenderer.invoke('lookup:query', word, context),
  // 生词本
  addToNotebook: (payload) => ipcRenderer.invoke('notebook:add', payload),
  listWords: () => ipcRenderer.invoke('notebook:list'),
  checkWords: (words) => ipcRenderer.invoke('notebook:has', words),
  restoreWord: (token) => ipcRenderer.invoke('notebook:restore', token),
  onDataChanged: (cb) => { const listener = (event, data) => cb(data); ipcRenderer.on('data:changed', listener); return () => ipcRenderer.removeListener('data:changed', listener) },
  installBrowser: () => ipcRenderer.invoke('app:installBrowser'),
  getIntegration: () => ipcRenderer.invoke('app:integration'),
  showBrowserFolder: () => ipcRenderer.invoke('app:browserFolder'),
  openAccessibility: () => ipcRenderer.invoke('app:accessibility'),
  removeWord: (idOrWord) => ipcRenderer.invoke('notebook:remove', idOrWord),
  updateWord: (id, patch) => ipcRenderer.invoke('notebook:update', id, patch),
  setStatus: (id, status) => ipcRenderer.invoke('notebook:setStatus', id, status),
  // 复习
  getReviewQueue: () => ipcRenderer.invoke('review:queue'),
  gradeCard: (id, grade, options) => ipcRenderer.invoke('review:grade', id, grade, options),
  getPending: () => ipcRenderer.invoke('review:pending'),
  // 默写
  getDictationQueue: (practice = false) => ipcRenderer.invoke('dictation:queue', practice),
  submitDictation: (payload) => ipcRenderer.invoke('dictation:submit', payload),
  onDictationPractice: (cb) => ipcRenderer.on('dictation:practice', () => cb()),
  onDictationRefresh: (cb) => ipcRenderer.on('dictation:refresh', () => cb()),
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  importDiffu: () => ipcRenderer.invoke('settings:importDiffu'),
  exportCSV: () => ipcRenderer.invoke('settings:export'),
  testApi: (patch) => ipcRenderer.invoke('settings:test', patch),
  // 打开其它窗口
  copyText: (text) => ipcRenderer.invoke('app:copy', text),
  getNavigation: () => ipcRenderer.invoke('app:navigation'),
  goBack: () => ipcRenderer.invoke('app:back'),
  onNavigationChanged: (cb) => ipcRenderer.on('navigation:changed', (event, data) => cb(data)),
  openWindow: (name) => ipcRenderer.invoke('app:open', name),
  // 划词查词：主进程把选中的词推送过来
  onLookupPrefill: (cb) => ipcRenderer.on('lookup:prefill', (e, word) => cb(word)),
  // 复习窗被重新唤起：主进程通知刷新队列（只刷新未开始的会话，不打断进行中）
  onReviewRefresh: (cb) => ipcRenderer.on('review:refresh', () => cb()),
})
