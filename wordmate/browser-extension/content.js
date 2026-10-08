(() => {
  if (globalThis.__wordmatePageTranslator) return
  globalThis.__wordmatePageTranslator = true
  const host = document.createElement('div')
  host.dataset.wordmateUi = 'panel'
  Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px', width: 'min(370px, calc(100vw - 24px))', fontSize: '14px' })
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `:host{all:initial}*{box-sizing:border-box}.panel{font:14px/1.6 system-ui,-apple-system,sans-serif;color:#182235;background:#fff;border:1px solid #dce3ef;border-radius:16px;box-shadow:0 12px 44px #14264230;max-height:75vh;overflow:auto;padding:16px}header{display:flex;align-items:center;justify-content:space-between;gap:8px}h3{margin:0;font-size:16px}.buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}button{font:inherit;background:#f1f5fc;color:#23456b;border:1px solid #dce3ef;border-radius:8px;padding:5px 10px;cursor:pointer}button:hover{background:#e3edff}p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#64748b;font-size:12px}.error{color:#b42318}.translation{font-size:16px}.meaning{padding:5px 0;border-bottom:1px solid #edf1f6}button:disabled{opacity:.5;cursor:default}select{font:inherit;padding:4px;border:1px solid #dce3ef;border-radius:6px}`
  shadow.append(style)
  let panel, body, toolbar, viewMode = 'page', lastSelection = null, selectionSeq = 0, pageSeq = 0, pageRunning = false
  const entries = new Map()
  let hovered = null, hoverSeq = 0
  const pendingHover = new Set()
  function element(tag, text, className) {
    const node = document.createElement(tag)
    if (text != null) node.textContent = text
    if (className) node.className = className
    return node
  }
  function button(label, action) { const node = element('button', label); node.type = 'button'; node.onclick = action; return node }
  function placeNear(rect) {
    if (!rect) return
    const width = Math.min(370, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 280))
    Object.assign(host.style, { left: left + 'px', right: 'auto', top: top + 'px' })
  }
  function display(title) {
    viewMode = title === '选区翻译' ? 'selection' : 'page'
    Object.assign(host.style, { top: '16px', right: '16px', left: 'auto' })
    if (!host.isConnected) document.documentElement.append(host)
    if (panel) panel.remove()
    panel = element('section', null, 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title)
    const header = element('header'); header.append(element('h3', title), button('关闭', () => { selectionSeq++; host.remove() }))
    body = element('div'); body.setAttribute('aria-live', 'polite')
    toolbar = element('div', null, 'buttons')
    panel.append(header, body, toolbar); shadow.append(panel)
    // 页面翻译过程中切到选词，也始终保留停止和恢复入口。
    toolbar.append(button('停止翻译', cancelPage), button('恢复原文', restorePage))
  }
  function status(text, error = false) {
    body.replaceChildren(element('p', text, error ? 'error' : 'muted'))
  }
  function selection() {
    const value = window.getSelection()
    if (!value?.rangeCount || !value.toString().trim()) return null
    const range = value.getRangeAt(0)
    const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    if (parent?.closest('[data-wordmate-ui]')) return null
    return { text: value.toString().trim(), context: (parent?.closest('p,li,blockquote,td')?.textContent || '').slice(0,4000), rect: range.getBoundingClientRect() }
  }
  document.addEventListener('contextmenu', () => { lastSelection = selection() }, true)
  async function translate(text, action, target, context = '') {
    const response = await chrome.runtime.sendMessage({ type: 'translate-text', action, text, target, context })
    if (!response?.ok) throw new Error(response?.error || '翻译失败，请确认 WordMate 已运行并安装新版连接')
    return response.result
  }
  async function translateSelection(input) {
    const selected = selection() || lastSelection
    const text = (input || selected?.text || '').trim()
    display('选区翻译')
    placeNear(selected?.rect)
    if (!text) { status('请先选中一个单词或一段文字，再点击翻译。', true); return }
    if (text.length > 12000) { status('选中文本超过 12000 字符，请缩短选区。', true); return }
    const seq = ++selectionSeq
    status('正在翻译…')
    try {
      const result = await translate(text, 'selection', 'zh', selected?.context || '')
      if (seq !== selectionSeq || !host.isConnected || viewMode !== 'selection') return
      body.replaceChildren(element('p', text, 'muted'))
      let copy = result.translation || ''
      if (result.type === 'word') {
        body.append(element('h3', result.word || text))
        const phonetic = [result.phonetic_us, result.phonetic_uk].filter(Boolean).join(' · ')
        if (phonetic) body.append(element('p', phonetic, 'muted'))
        for (const definition of result.definitions || []) body.append(element('p', `${definition.pos || ''} ${definition.meaning || ''}`, 'meaning'))
        copy = (result.definitions || []).map(d => `${d.pos || ''} ${d.meaning || ''}`).join('\n')
        body.append(element('p', result.inNotebook ? '✓ 已在生词本' : '是否自动收录由桌面设置决定', 'muted'))
      } else body.append(element('p', result.translation, 'translation'))
      for (const example of (result.examples || []).slice(0,2)) body.append(element('p', `${example.en || ''}\n${example.zh || ''}`, 'muted'))
      if (result.notes) body.append(element('p', result.notes, 'muted'))
      toolbar.prepend(button('复制译文', async event => {
        try { await navigator.clipboard.writeText(copy); event.target.textContent = '已复制' }
        catch { status('浏览器未允许复制，请手动选中译文复制。', true) }
      }), button('重试', () => translateSelection(text)))
    } catch (error) {
      if (seq !== selectionSeq || viewMode !== 'selection') return
      status(error.message, true)
      toolbar.prepend(button('重试', () => translateSelection(text)))
    }
  }
  function cancelPage() { hoverSeq++; pageSeq++; pageRunning = false; if (body) status('已停止，已显示的译文保留；可恢复原文。') }
  function restorePage() {
    cancelPage(); selectionSeq++; hoverSeq++
    for (const entry of entries.values()) entry.output.remove()
    entries.clear()
    display('网页翻译'); status('已恢复原文。')
  }
  const excluded = 'script,style,noscript,textarea,input,select,option,pre,code,svg,canvas,[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-wordmate-ui],[data-wordmate-translation]'
  function sourceNodes(target) {
    const groups = new Map()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement, text = node.textContent.trim()
      if (!parent || !text || parent.closest(excluded)) continue
      const computed = getComputedStyle(parent)
      if (computed.display === 'none' || computed.visibility === 'hidden' || !parent.getClientRects().length) continue
      const block = parent.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,figcaption,dt,dd') || parent.closest('button,a,div') || parent
      if (!groups.has(block)) groups.set(block, [])
      groups.get(block).push(node)
    }
    return [...groups].map(([block, nodes]) => ({ block, nodes, text: nodes.map(node => node.textContent).join('') }))
      .filter(group => {
        const previous = entries.get(group.block)
        if (previous?.original === group.text && previous.target === target) return false
        if (previous) { previous.output.remove(); entries.delete(group.block) }
        return target === 'zh' ? /[A-Za-z]{2}/.test(group.text) : /[\u3400-\u9fff]/.test(group.text)
      })
  }
  function parts(text, limit = 4000) {
    const chunks = []
    while (text.length > limit) {
      let split = text.lastIndexOf(' ', limit)
      if (split < limit / 2) split = limit
      chunks.push(text.slice(0, split)); text = text.slice(split)
    }
    if (text) chunks.push(text)
    return chunks
  }
  async function translatePage(target = 'zh') {
    if (pageRunning) { selectionSeq++; display('网页翻译'); status('正在翻译当前页面，请等待或先停止。'); return }
    // 切换目标语言时清掉旧译文，以当前原文重新翻译。
    if ([...entries.values()].some(entry => entry.target !== target)) restorePage()
    selectionSeq++; display('网页双语翻译')
    const nodes = sourceNodes(target), seq = ++pageSeq
    if (!nodes.length) { status(entries.size ? '当前页面已经翻译完成。' : '未找到可翻译的可见文字。图片、代码、表单和未加载内容不翻译。'); return }
    pageRunning = true
    let next = 0, finished = 0, failures = 0, firstError = '', abort = false
    const renderProgress = () => { if (seq === pageSeq && viewMode === 'page') status(`已翻译 ${finished} / ${nodes.length} 处${failures ? `，${failures} 处失败` : ''}。原文保留，译文显示在原文旁。`) }
    renderProgress()
    async function worker() {
      while (next < nodes.length && seq === pageSeq && !abort) {
        const group = nodes[next++], node = group.block, original = group.text
        try {
          const translated = []
          for (const part of parts(original.trim())) {
            if (seq !== pageSeq || abort) return
            const result = await translate(part, 'page', target)
            translated.push(result.translation)
          }
          if (seq !== pageSeq || entries.has(node) || !node.isConnected || group.nodes.map(source => source.textContent).join('') !== original) continue
          const output = element('span', translated.join(' '))
          output.dataset.wordmateTranslation = 'true'; output.lang = target === 'en' ? 'en' : 'zh-CN'
          // 使用 DOM 文本，绝不把模型响应当作网页 HTML 执行。
          output.style.cssText = 'display:block!important;color:inherit!important;opacity:0.85!important;background:transparent!important;font-size:0.98em!important;line-height:1.75!important;padding:2px 0!important;margin:6px 0 12px!important;border:none!important;white-space:pre-wrap!important;'
          if (node.matches('td,th,li,button,a')) node.append(output)
          else node.after(output)
          entries.set(node, { output, target, original }); finished++
        } catch (error) {
          if (seq !== pageSeq) return
          failures++; firstError ||= error.message
          // 连接/配置失效时停止整页队列，避免对每个节点重复请求。
          if (/connect|host|连接|配置|运行|API Key|HTTP 40[134]|HTTP 429/i.test(error.message)) abort = true
        }
        renderProgress()
      }
    }
    await Promise.all([worker(), worker()])
    if (seq !== pageSeq) return
    pageRunning = false
    if (viewMode !== 'page') return
    status(`翻译完成：${finished} 处成功${failures ? `，${failures} 处失败：${firstError}` : ''}${abort ? '；后续内容未翻译，请修复连接后重试。' : ''}。`, failures > 0)
    toolbar.prepend(button(failures || abort ? '重试未完成内容' : '翻译新加载内容', () => translatePage(target)))
  }
  // 激活当前页后，划词出现轻量入口，不在每次选区变化时自动调用模型。
  const chipHost = document.createElement('div')
  chipHost.dataset.wordmateUi = 'selection-entry'
  Object.assign(chipHost.style, { position:'fixed', zIndex:'2147483647' })
  const chipShadow = chipHost.attachShadow({ mode:'closed' })
  const chipStyle = element('style')
  chipStyle.textContent = 'button{font:13px system-ui;background:#246bce;color:white;padding:7px 12px;border:0;border-radius:18px;box-shadow:0 3px 14px #1233;cursor:pointer}'
  const chip = button('翻译', () => { const text = lastSelection?.text; chipHost.remove(); translateSelection(text) })
  chipShadow.append(chipStyle, chip)
  chipHost.addEventListener('mousedown', event => event.preventDefault())
  document.addEventListener('mouseup', event => {
    if (event.composedPath().includes(host) || event.composedPath().includes(chipHost)) return
    const selected = selection()
    if (!selected || selected.text.length > 12000) { chipHost.remove(); return }
    lastSelection = selected
    chipHost.style.left = Math.max(8, Math.min(selected.rect.right, innerWidth - 70)) + 'px'
    chipHost.style.top = Math.max(8, Math.min(selected.rect.bottom + 6, innerHeight - 40)) + 'px'
    document.documentElement.append(chipHost)
  })
  document.addEventListener('scroll', () => chipHost.remove(), true)
  document.addEventListener('mousemove', event => { hovered = event.target }, { passive:true })
  document.addEventListener('keydown', async event => {
    if (event.key !== 'Shift' || event.repeat || !hovered?.closest || hovered.closest(excluded)) return
    const block = hovered.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote')
    if (!block || pendingHover.has(block) || entries.has(block)) return
    const group = sourceNodes('zh').find(item => item.block === block)
    if (!group) return
    const seq = hoverSeq
    pendingHover.add(block)
    try {
      const translations = []
      for (const part of parts(group.text)) translations.push((await translate(part, 'page', 'zh')).translation)
      if (seq !== hoverSeq || entries.has(block) || !block.isConnected || group.nodes.map(node => node.textContent).join('') !== group.text) return
      const output = element('span', translations.join(' '))
      output.dataset.wordmateTranslation = 'true'
      output.style.cssText = 'display:block!important;color:inherit!important;opacity:.85!important;line-height:1.75!important;margin:6px 0 12px!important;white-space:pre-wrap!important;'
      if (block.matches('li,td,th')) block.append(output); else block.after(output)
      entries.set(block, { output, target:'zh', original:group.text })
    } catch (error) { display('段落翻译'); status(error.message,true) }
    finally { pendingHover.delete(block) }
  })
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.command) return false
    if (message.command === 'activate') { display('WordMate 双语阅读'); status('已启用当前页：选中文字后点击翻译按钮；鼠标停在段落上按 Shift 可只翻译该段。') }
    else if (message.command === 'selection') translateSelection(message.text).catch(error => { display('翻译失败'); status(error.message, true) })
    else if (message.command === 'page') translatePage(message.target).catch(error => { pageRunning = false; display('翻译失败'); status(error.message, true) })
    else if (message.command === 'restore') restorePage()
    else if (message.command === 'cancel') cancelPage()
    else return false
    respond({ ok: true }); return false
  })
})()
