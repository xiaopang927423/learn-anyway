// 所有页面统一显示可读错误；不把异常留在控制台。
window.ui = {
  error(error) {
    let el = document.getElementById('page-error')
    if (!el) {
      el = document.createElement('p')
      el.id = 'page-error'; el.className = 'error-box'; el.setAttribute('role', 'alert')
      document.body.prepend(el)
    }
    el.hidden = false
    el.textContent = error?.message || String(error || '操作失败，请重试')
  },
  async run(button, task) {
    if (button?.disabled) return
    if (button) button.disabled = true
    try { return await task() }
    catch (error) { window.ui.error(error) }
    finally { if (button?.isConnected) button.disabled = false }
  },
}
window.addEventListener('unhandledrejection', event => { event.preventDefault(); ui.error(event.reason) })
async function navigate(task) {
  if (window.confirmNavigation && !await window.confirmNavigation()) return
  await ui.run(null, task)
}
const navigationBar = document.createElement('nav')
navigationBar.className = 'page-navigation'
navigationBar.setAttribute('aria-label', '页面导航')
const backButton = document.createElement('button')
backButton.id = 'back-button'
backButton.type = 'button'
backButton.textContent = '← 返回查词'
backButton.onclick = () => navigate(() => wm.goBack())
const homeButton = document.createElement('button')
homeButton.type = 'button'; homeButton.textContent = '查词'
homeButton.onclick = () => navigate(() => wm.openWindow('lookup'))
navigationBar.append(backButton, homeButton)
document.body.prepend(navigationBar)
let pageName = ''
function updateNavigation(state) {
  pageName = state.name
  navigationBar.hidden = state.name === 'lookup' && !state.canGoBack
  backButton.textContent = '← 返回' + (state.label || '查词')
}
wm.getNavigation().then(updateNavigation).catch(ui.error)
wm.onNavigationChanged(updateNavigation)
document.addEventListener('click', event => {
  const target = event.target.closest('[data-open]')
  if (target) { event.preventDefault(); navigate(() => wm.openWindow(target.dataset.open)) }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    event.preventDefault(); event.stopImmediatePropagation()
    navigate(() => wm.goBack())
  }
}, true)
