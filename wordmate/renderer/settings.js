const $ = id => document.getElementById(id)
let messageSeq = 0
let savedForm = null
const snapshot = () => JSON.stringify([...document.querySelectorAll('.form-card input')].map(el => [el.id, el.type === 'checkbox' ? el.checked : el.value]))
function message(text, error = false) {
  messageSeq++
  $('msg').textContent = text
  $('msg').style.color = error ? 'var(--danger)' : 'var(--ok)'
}
function formValues() {
  const count = Number($('dictationCount').value)
  if (!Number.isInteger(count) || count < 0 || count > 200) throw new Error('每轮默写词数须为 0–200 的整数')
  return { baseUrl: $('baseUrl').value.trim().replace(/\/+$/, ''), apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || 'qwen-turbo', remindTime: $('remindTime').value || '20:00',
    notifyEnabled: $('notifyEnabled').checked, autoAdd: $('autoAdd').checked,
    dictationCount: count, dictationAffectsSchedule: $('dictationAffectsSchedule').checked }
}
async function load() {
  try {
    const s = await wm.getSettings()
    for (const field of ['baseUrl','apiKey','model','remindTime']) $(field).value = s[field] || ''
    for (const field of ['notifyEnabled','autoAdd','dictationAffectsSchedule']) $(field).checked = s[field] !== false
    $('dictationCount').value = s.dictationCount ?? 10
    $('provider').value = s.model === 'diffu' ? 'diffu' : 'custom'
    $('provider').dataset.previous = $('provider').value
    savedForm = snapshot()
    await integrations()
  } catch (error) { message('加载失败：' + error.message, true) }
}
$('save').onclick = () => ui.run($('save'), async () => {
  try { await wm.saveSettings(formValues()); savedForm = snapshot(); message('✓ 已保存') }
  catch (error) { message('保存失败：' + error.message, true) }
})
$('test').onclick = () => ui.run($('test'), async () => {
  const seq = ++messageSeq
  $('msg').textContent = '测试中…'
  try {
    const r = await wm.testApi(formValues())
    if (seq !== messageSeq) return
    if (!r.ok) throw new Error(r.error)
    message(`✓ 连接成功（${r.ms}ms${r.reply ? '，回复：' + r.reply : ''}）`)
  } catch (error) { if (seq === messageSeq) message('连接失败：' + error.message, true) }
})
$('export').onclick = () => ui.run($('export'), async () => {
  try { const r = await wm.exportCSV(); message(r.saved ? '✓ 已导出到 ' + r.filePath : '已取消') }
  catch (error) { message('导出失败：' + error.message, true) }
})
const drafts = new Map()
$('provider').onchange = () => {
  const next = $('provider').value
  if (next === 'custom') return
  const previous = $('provider').dataset.previous || 'custom'
  drafts.set(previous, { baseUrl: $('baseUrl').value, model: $('model').value, apiKey: $('apiKey').value })
  const values = drafts.get(next) || (next === 'diffu'
    ? { baseUrl: 'http://43.107.54.53:31003/v1', model: 'diffu', apiKey: '' }
    : { baseUrl: '', model: 'qwen-turbo', apiKey: '' })
  Object.entries(values).forEach(([key,value]) => { $(key).value = value })
  $('provider').dataset.previous = next
  message('预设已填入，请确认密钥并保存')
}
$('importDiffu').onclick = () => ui.run($('importDiffu'), async () => {
  try {
    const r = await wm.importDiffu()
    if (r.canceled) return
    if (!r.ok) throw new Error(r.error)
    await load(); message('✓ Diffu 配置已导入并保存')
  } catch (error) { message('导入失败：' + error.message, true) }
})
async function integrations() {
  const state = await wm.getIntegration()
  $('integration-status').textContent = `系统服务：${state.services ? '已启用' : '需运行打包应用'}；⌥Space：${state.shortcuts.lookup ? '可用' : '未注册 / 被占用'}；⌥D：${state.shortcuts.selection ? '可用' : '未注册 / 被占用'}；浏览器连接：${state.browser ? '已安装' : '未安装'}`
}
$('browser-install').onclick = () => ui.run($('browser-install'), async () => {
  const r = await wm.installBrowser()
  if (!r.ok) throw new Error(r.error)
  await integrations(); await wm.showBrowserFolder(); message('连接已安装，请在浏览器扩展页加载打开的 browser-extension 文件夹')
})
$('accessibility').onclick = () => ui.run($('accessibility'), () => wm.openAccessibility())
load()

let navigationPrompt = null
window.confirmNavigation = () => {
  if (savedForm === null || snapshot() === savedForm) return Promise.resolve(true)
  if (navigationPrompt) return navigationPrompt
  navigationPrompt = new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.innerHTML = '<h2>设置尚未保存</h2><p>返回前保存本次修改？</p><p id="leave-error" class="msg"></p><div class="btn-row"><button data-choice="cancel">继续编辑</button><button data-choice="discard">放弃修改并返回</button><button data-choice="save" class="primary">保存并返回</button></div>'
    const finish = value => { dialog.close(); dialog.remove(); navigationPrompt = null; resolve(value) }
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
    dialog.querySelector('[data-choice="cancel"]').onclick = () => finish(false)
    dialog.querySelector('[data-choice="discard"]').onclick = async () => { await load(); finish(true) }
    dialog.querySelector('[data-choice="save"]').onclick = async event => {
      event.target.disabled = true
      try { await wm.saveSettings(formValues()); savedForm = snapshot(); finish(true) }
      catch (error) { dialog.querySelector('#leave-error').textContent = error.message; event.target.disabled = false }
    }
    document.body.append(dialog); dialog.showModal()
  })
  return navigationPrompt
}
