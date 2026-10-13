const $ = id => document.getElementById(id)
async function pageCommand(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('请先打开一个网页')
  if ((command === 'pdf' || command === 'page' && /\.pdf(?:[?#]|$)/i.test(tab.url || '')) && /^https?:\/\//i.test(tab.url || '')) {
    const origins = [new URL(tab.url).origin + '/*']
    if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) throw new Error('需要当前 PDF 站点的读取权限，才能在当前标签页显示双语。')
  }
  const response = await chrome.runtime.sendMessage({ type: 'command', command, tabId: tab.id, target: $('target').value, readingMode: $('readingMode').value })
  if (!response?.ok) throw new Error(response?.error || '无法打开网页翻译')
  return response
}
for (const command of ['activate','page','pdf','selection','cancel','restore']) {
  $(command).onclick = async event => {
    event.target.disabled = true; $('status').textContent = ''
    try { await pageCommand(command); window.close() }
    catch (error) { $('status').textContent = error.message }
    finally { event.target.disabled = false }
  }
}
$('readingMode').onchange = async () => {
  try { await pageCommand('mode'); $('status').textContent = '' }
  catch (error) { $('status').textContent = error.message }
}
$('thinkingEnabled').onchange = async event => {
  const control = event.target, requested = control.checked
  control.disabled = true
  try {
    const response = await chrome.runtime.sendMessage({ type: 'preferences', thinkingEnabled: requested })
    if (!response?.ok) throw new Error(response?.error || '设置未保存')
    control.checked = response.result.thinkingEnabled
    $('status').textContent = requested ? '已开启深度思考' : '已关闭深度思考'
  } catch (error) { control.checked = !requested; $('status').textContent = error.message }
  finally { control.disabled = false }
}
async function loadPreferences() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'preferences' })
    if (!response?.ok) throw new Error(response?.error || '无法连接新版 WordMate')
    $('thinkingEnabled').checked = response.result.thinkingEnabled
    $('thinkingEnabled').disabled = false
  } catch (error) { $('status').textContent = error.message }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const response = await chrome.runtime.sendMessage({ type: 'command', command: 'get-state', tabId: tab.id })
    if (response?.state) { $('readingMode').value = response.state.readingMode; $('target').value = response.state.target; $('auto-status').textContent = response.state.autoTranslating ? '自动补译已开启：滚动、展开和新内容加载会继续翻译。' : '启动页面翻译后自动补译；停止或恢复原文后关闭。' }
  } catch { /* 浏览器禁止注入时保留默认选项，由操作时显示提示 */ }
}
loadPreferences()
