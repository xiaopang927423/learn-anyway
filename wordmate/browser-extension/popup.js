for (const command of ['activate','page','selection','cancel','restore']) {
  document.getElementById(command).onclick = async event => {
    event.target.disabled = true
    const status = document.getElementById('status')
    status.textContent = ''
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('请先打开一个网页')
      const response = await chrome.runtime.sendMessage({ type: 'command', command, tabId: tab.id, target: document.getElementById('target').value })
      if (!response?.ok) throw new Error(response?.error || '无法打开网页翻译')
      window.close()
    } catch (error) { status.textContent = error.message }
    finally { event.target.disabled = false }
  }
}
