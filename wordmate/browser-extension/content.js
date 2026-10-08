(() => {
  if (globalThis.__wordmatePageTranslator) return
  globalThis.__wordmatePageTranslator = true
  const host = document.createElement('div')
  host.dataset.wordmateUi = 'panel'
  Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px', width: 'min(370px, calc(100vw - 24px))', fontSize: '14px' })
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `:host{all:initial}*{box-sizing:border-box}.panel{font:14px/1.6 system-ui,-apple-system,sans-serif;color:#182235;background:#fff;border:1px solid #dce3ef;border-radius:16px;box-shadow:0 12px 44px #14264230;max-height:75vh;overflow:auto;padding:12px}[hidden]{display:none!important}header{display:flex;align-items:center;justify-content:space-between;gap:8px}h3{margin:0;font-size:16px}.buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}button{font:inherit;background:#f1f5fc;color:#23456b;border:1px solid #dce3ef;border-radius:8px;padding:5px 10px;cursor:pointer}button:hover{background:#e3edff}p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#64748b;font-size:12px}.error{color:#b42318}.translation{font-size:16px}.meaning{padding:5px 0;border-bottom:1px solid #edf1f6}button:disabled{opacity:.5;cursor:default}header button{font-size:12px;padding:4px 7px}select{font:inherit;padding:4px;border:1px solid #dce3ef;border-radius:6px}`
  shadow.append(style)
  let panel, body, toolbar, viewMode = 'page', lastSelection = null, selectionSeq = 0, pageSeq = 0, pageRunning = false
  const entries = new Map()
  let readingMode = 'bilingual', currentTarget = 'zh', modeButtons = [], collapseButton, panelCollapsed = false
  let hovered = null, hoverSeq = 0
  const pendingHover = new Set()
  let autoWatching = false, autoTimer = null, autoObserver = null
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
  function collapse(value) {
    panelCollapsed = value
    body.hidden = value; toolbar.hidden = value
    if (collapseButton) collapseButton.textContent = value ? '展开' : '收起'
  }
  function display(title) {
    viewMode = title === '选区翻译' ? 'selection' : 'page'
    Object.assign(host.style, { top: viewMode === 'page' ? 'auto' : '16px', bottom: viewMode === 'page' ? '16px' : 'auto', right: '16px', left: 'auto' })
    if (!host.isConnected) document.documentElement.append(host)
    if (panel) panel.remove()
    panel = element('section', null, 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title)
    const header = element('header'); header.append(element('h3', title))
    collapseButton = viewMode === 'page' ? button('收起', () => collapse(!panelCollapsed)) : null
    if (collapseButton) header.append(collapseButton)
    header.append(button('关闭', () => { selectionSeq++; host.remove() }))
    body = element('div'); body.setAttribute('aria-live', 'polite')
    toolbar = element('div', null, 'buttons')
    panel.append(header, body, toolbar); shadow.append(panel)
    // 页面翻译过程中切到选词，也始终保留停止和恢复入口。
    modeButtons = []
    if (viewMode === 'page') {
      for (const [mode, label] of [['bilingual', '双语对照'], ['translated', currentTarget === 'zh' ? '仅中文' : '仅译文']]) {
        const control = button(label, () => setReadingMode(mode))
        control.dataset.mode = mode; modeButtons.push(control); toolbar.append(control)
      }
    }
    toolbar.append(button('停止翻译', cancelPage), button('恢复原文', restorePage))
    collapse(false); updateModeButtons()
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
    return { text: value.toString().trim(), context: (parent?.closest('p,li,blockquote,td')?.innerText || '').slice(0,4000), rect: range.getBoundingClientRect() }
  }
  document.addEventListener('contextmenu', () => { lastSelection = selection() }, true)
  async function translate(text, action, target, context = '', segments) {
    const response = await chrome.runtime.sendMessage({ type: 'translate-text', action, text, target, context, segments })
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
        const notebookButton = button(result.inNotebook ? '✓ 已收录' : '加入生词本', async event => {
          const control = event.currentTarget
          control.disabled = true
          try {
            const saved = await translate(text, 'add-word', 'zh', selected?.context || '')
            result.inNotebook = saved.inNotebook
            control.textContent = '✓ 已收录'
          } catch (error) {
            control.disabled = false
            body.append(element('p', error.message, 'error'))
          }
        })
        notebookButton.dataset.action = 'add-word'
        notebookButton.disabled = result.inNotebook === true
        body.append(notebookButton)
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
  function cancelPage() { autoWatching = false; clearTimeout(autoTimer); hoverSeq++; pageSeq++; pageRunning = false; if (body) status('已停止，已显示的译文保留；可恢复原文。') }
  function restorePage() {
    cancelPage(); selectionSeq++; hoverSeq++
    for (const entry of entries.values()) removeEntry(entry)
    entries.clear()
    display('网页翻译'); status('已恢复原文。')
  }
  const excluded = 'script,style,noscript,textarea,input,select,option,pre,code,svg,canvas,[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-wordmate-ui],[data-wordmate-translation],nav,header,footer,aside,button,[role=button],[role=tab],[role=menu],[role=toolbar],[role=navigation],[role=tree],[role=grid],[role=row],time'
  const postSelector = '[data-testid="tweetText"],[data-testid="postText"],[data-post-body],[data-content="post-body"]'
  const hardExcluded = 'script,style,noscript,textarea,input,select,option,pre,code,svg,canvas,[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-wordmate-ui],[data-wordmate-translation],nav,header,footer,aside,button,[role=tab],[role=menu],[role=toolbar],[role=navigation],time'
  function postBody(parent) {
    const explicit = parent.closest(postSelector)
    if (explicit) return explicit
    const article = parent.closest('article,[role=article]')
    if (!article || article.classList.contains('markdown-body')) return null
    const candidate = parent.closest('[dir=auto]')
    if (!candidate || !article.contains(candidate) || candidate.closest('[data-testid="User-Name"],[data-testid="socialContext"]')) return null
    const text = candidate.textContent.trim()
    // 通用信息流回退只接受完整文本，不将短用户名和时间当作帖子。
    return text.split(/\s+/).length >= 6 && !candidate.querySelector('time,button,[role=toolbar],[data-testid="User-Name"],[data-testid="socialContext"],article,[role=article]') ? candidate : null
  }
  function isExcluded(parent) {
    if (parent.closest(hardExcluded)) return true
    const post = postBody(parent)
    if (!post) return !!parent.closest(excluded)
    // 引用帖的外层可点击容器不是正文按钮；正文内部的按钮仍排除。
    for (let node = parent; node; node = node.parentElement) {
      if (node.matches('[role=button],[role=tree],[role=grid],[role=row]')) return true
      if (node === post) break
    }
    return false
  }
  function updateModeButtons() {
    for (const control of modeButtons) {
      control.disabled = control.dataset.mode === readingMode
      control.setAttribute('aria-pressed', String(control.disabled))
    }
  }
  function expectedText(source) { return readingMode === 'translated' ? source.translated : source.original }
  function removeEntry(entry) {
    // 只恢复仍然是本扩展写入的文本，不覆盖网站随后更新的内容。
    for (const source of entry.sources) if (source.node.isConnected && source.node.textContent === source.translated) source.node.textContent = source.original
    for (const change of entry.layout || []) if (entry.block.style.getPropertyValue(change.name) === change.applied) {
      if (change.before) entry.block.style.setProperty(change.name, change.before, change.priority)
      else entry.block.style.removeProperty(change.name)
    }
    entry.output.remove()
  }
  function reconcileEntries() {
    for (const [block, entry] of entries) {
      if (!block.isConnected || entry.sources.some(source => !block.contains(source.node) || source.node.textContent !== expectedText(source))) {
        removeEntry(entry); entries.delete(block)
      }
    }
  }
  function setReadingMode(mode) {
    if (!['bilingual', 'translated'].includes(mode)) return
    reconcileEntries()
    readingMode = mode
    for (const entry of entries.values()) {
      for (const source of entry.sources) source.node.textContent = mode === 'translated' ? source.translated : source.original
      entry.output.style.setProperty('display', mode === 'translated' ? 'none' : 'block', 'important')
    }
    updateModeButtons()
    if (viewMode === 'page' && panel?.querySelector('h3') && entries.size) panel.querySelector('h3').textContent = mode === 'bilingual' ? '网页双语对照' : (currentTarget === 'zh' ? '网页仅中文' : '网页仅译文')
  }
  const proseSelector = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dt,dd,td,th'
  function readingRoots() {
    // 优先文档 / 文章正文；例如仓库页面中的 README，而不是整个文件浏览器。
    const articles = [...document.querySelectorAll('.markdown-body,article,[role=article]')]
      .filter(root => !isExcluded(root) && root.getClientRects().length)
    const posts = [...document.querySelectorAll(postSelector)].filter(root => !isExcluded(root) && root.getClientRects().length)
    if (articles.length || posts.length) return [...articles.filter(root => !articles.some(other => other !== root && other.contains(root))), ...posts]
    return [document.querySelector('main,[role=main]') || document.body]
  }
  function protectedText(text) {
    const value = text.trim()
    return /^\.?[\w@.-]+(?:\/[\w@.-]+)+$/.test(value) || /^\.[\w.-]+$/.test(value) ||
      /^[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+$/.test(value) || /^[a-f0-9]{7,40}$/i.test(value) || /^#[0-9]+$/.test(value) ||
      /^\d+\s+(?:branches?|tags?|commits?|hours?|days?|weeks?|months?|years?)(?:\s+ago)?$/i.test(value) ||
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value)
  }
  function eligibleBlock(parent, roots) {
    const post = postBody(parent)
    if (post && !isExcluded(parent) && roots.some(root => root.contains(post))) return post
    const block = parent.closest(proseSelector)
    if (!block || block.closest(excluded) || !roots.some(root => root.contains(block))) return null
    // 正文外的文件表格、导航链接列表、徽章和可点击整行不是阅读段落。
    const article = block.closest('.markdown-body,article,[role=article]')
    if (article && block.tagName === 'H1' && article.querySelector('h1') === block && /^[A-Za-z0-9_.-]+$/.test(block.textContent.trim())) return null
    if (!article && block.closest('table,[role=listbox]')) return null
    if (block.matches('li') && !block.querySelector('p') && block.querySelector('a') && block.textContent.trim().split(/\s+/).length < 5) return null
    const computed = getComputedStyle(block)
    if (computed.display === 'flex' || computed.display === 'inline-flex' || computed.display === 'grid' || computed.display === 'inline-grid' || computed.whiteSpace === 'nowrap') return null
    return block
  }
  function sourceNodes(target) {
    reconcileEntries()
    const groups = new Map(), roots = readingRoots()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement
      if (!parent || isExcluded(parent)) continue
      if (!node.textContent.trim() && !parent.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,figcaption,dt,dd') && !postBody(parent)) continue
      const computed = getComputedStyle(parent)
      if (computed.display === 'none' || computed.visibility === 'hidden' || !parent.getClientRects().length) continue
      const block = eligibleBlock(parent, roots)
      if (!block || entries.has(block)) continue
      if (!groups.has(block)) groups.set(block, [])
      groups.get(block).push(node)
    }
    return [...groups].map(([block, nodes]) => ({ block, nodes, text: nodes.map(node => node.textContent).join('') }))
      .filter(group => !protectedText(group.text))
      .filter(group => target === 'zh' ? /[A-Za-z]{2}/.test(group.text) : /[\u3400-\u9fff]/.test(group.text))
  }
  function packets(group) {
    const result = [], fragments = []
    group.nodes.forEach((node, index) => {
      const text = node.textContent
      if (!text) { fragments.push({ index, text: '' }); return }
      for (let offset = 0; offset < text.length; offset += 4000) fragments.push({ index, text: text.slice(offset, offset + 4000) })
    })
    let packet = [], length = 0
    for (const fragment of fragments) {
      if (packet.length && (length + fragment.text.length > 4000 || packet.length >= 64)) { result.push(packet); packet = []; length = 0 }
      packet.push(fragment); length += fragment.text.length
    }
    if (packet.length) result.push(packet)
    return result
  }
  async function translateGroup(group, target, valid) {
    const sources = group.nodes.map(node => ({ node, original: node.textContent, translated: '' }))
    for (const packet of packets(group)) {
      if (!valid()) return null
      const fragments = packet.map(fragment => fragment.text)
      // 空白片段直接保留，不向模型发送空文本。
      if (!fragments.join('').trim()) { for (const fragment of packet) sources[fragment.index].translated += fragment.text; continue }
      const result = await translate(fragments.join(''), 'page', target, '', fragments)
      if (!Array.isArray(result.segments) || result.segments.length !== fragments.length) throw new Error('译文缺少排版片段，请重试或更新桌面应用')
      result.segments.forEach((text, index) => { const fragment = packet[index]; sources[fragment.index].translated += protectedText(fragment.text) ? fragment.text : text })
    }
    if (!valid() || !group.block.isConnected || sources.some(source => !group.block.contains(source.node) || source.node.textContent !== source.original)) return null
    return { sources, translation: sources.map(source => source.translated).join('') }
  }
  function insertEntry(group, translated, target) {
    if (entries.has(group.block)) return
    const output = element('span', translated.translation)
    output.dataset.wordmateTranslation = 'true'; output.lang = target === 'en' ? 'en' : 'zh-CN'
    output.style.cssText = 'display:block!important;color:inherit!important;background:transparent!important;opacity:1!important;font:inherit!important;line-height:1.7!important;text-align:inherit!important;padding:6px 0 0!important;margin:6px 0 0!important;border:0!important;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)!important;white-space:normal!important;overflow-wrap:anywhere!important;letter-spacing:normal!important;'
    if (/^H[1-6]$/.test(group.block.tagName)) output.style.setProperty('font-size', '0.88em', 'important')
    // 译文留在同一个原生段落 / 网格单元内，不新增父布局的独立网格项。
    group.block.append(output)
    const layout = []
    const computed = getComputedStyle(group.block)
    if (postBody(group.block) && parseInt(computed.webkitLineClamp, 10) > 0) {
      for (const [name, applied] of [['-webkit-line-clamp','none'],['max-height','none'],['overflow','visible'],['display','block']]) {
        layout.push({ name, applied, before: group.block.style.getPropertyValue(name), priority: group.block.style.getPropertyPriority(name) })
        group.block.style.setProperty(name, applied, 'important')
      }
    }
    const entry = { output, target, original: group.text, sources: translated.sources, block: group.block, layout }
    entries.set(group.block, entry)
    if (readingMode === 'translated') {
      for (const source of entry.sources) source.node.textContent = source.translated
      output.style.setProperty('display', 'none', 'important')
    }
  }
  function scheduleContent() {
    clearTimeout(autoTimer)
    if (!autoWatching) return
    autoTimer = setTimeout(() => {
      if (!autoWatching) return
      if (pageRunning) { scheduleContent(); return }
      if (sourceNodes(currentTarget).length) translatePage(currentTarget, true)
    }, 300)
  }
  function watchContent(groups) {
    autoWatching = true
    if (!autoObserver) autoObserver = new MutationObserver(records => {
      if (!autoWatching) return
      const changed = records.some(record => record.type === 'attributes'
        ? !record.target.closest('[data-wordmate-ui],[data-wordmate-translation]')
        : record.type === 'characterData'
        ? !record.target.parentElement?.closest('[data-wordmate-ui],[data-wordmate-translation]')
        : [...record.addedNodes].some(node => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !node.matches('[data-wordmate-ui],[data-wordmate-translation]'))))
      if (changed) scheduleContent()
    })
    autoObserver.disconnect()
    autoObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class','style','hidden','aria-hidden','dir','data-testid'] })
  }
  async function translatePage(target = 'zh', automatic = false) {
    currentTarget = target
    if (pageRunning) { selectionSeq++; display('网页翻译'); status('正在翻译当前页面，请等待或先停止。'); return }
    // 切换目标语言时清掉旧译文，以当前原文重新翻译。
    if ([...entries.values()].some(entry => entry.target !== target)) restorePage()
    if (!automatic) { selectionSeq++; display(readingMode === 'bilingual' ? '网页双语对照' : (target === 'zh' ? '网页仅中文' : '网页仅译文')) }
    const nodes = sourceNodes(target), seq = ++pageSeq
    watchContent(nodes)
    if (!nodes.length) { status(entries.size ? '当前页面已经翻译完成。' : '未找到可翻译的可见文字。图片、代码、表单和未加载内容不翻译。'); return }
    pageRunning = true
    let next = 0, finished = 0, failures = 0, firstError = '', abort = false
    const renderProgress = () => { if (seq === pageSeq && viewMode === 'page') status(`已翻译 ${finished} / ${nodes.length} 处${failures ? `，${failures} 处失败` : ''}。${readingMode === 'bilingual' ? '逐段双语对照' : '仅译文阅读'}。`) }
    renderProgress()
    async function worker() {
      while (next < nodes.length && seq === pageSeq && !abort) {
        const group = nodes[next++], node = group.block, original = group.text
        try {
          const translated = await translateGroup(group, target, () => seq === pageSeq && !abort)
          if (!translated || seq !== pageSeq || entries.has(node)) continue
          insertEntry(group, translated, target); finished++
        } catch (error) {
          if (seq !== pageSeq) return
          failures++; firstError ||= error.message
          // 连接/配置失效时停止整页队列，避免对每个节点重复请求。
          if (/connect|host|连接|配置|运行|API Key|HTTP 40[134]|HTTP 429/i.test(error.message)) { abort = true; autoWatching = false }
        }
        renderProgress()
      }
    }
    await Promise.all([worker(), worker()])
    if (seq !== pageSeq) return
    pageRunning = false
    if (failures) autoWatching = false
    if (viewMode !== 'page') return
    status(`翻译完成：${finished} 处成功${failures ? `，${failures} 处失败：${firstError}` : ''}${abort ? '；后续内容未翻译，请修复连接后重试。' : autoWatching ? '；自动补译新内容已开启' : ''}。`, failures > 0)
    toolbar.prepend(button(failures || abort ? '重试未完成内容' : '翻译新加载内容', () => translatePage(target)))
    if (!failures && !abort) collapse(true)
    if (autoWatching) scheduleContent()
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
  document.addEventListener('scroll', () => { chipHost.remove(); if (autoWatching) scheduleContent() }, true)
  window.addEventListener('resize', () => { if (autoWatching) scheduleContent() })
  document.addEventListener('mousemove', event => { hovered = event.target }, { passive:true })
  document.addEventListener('keydown', async event => {
    if (event.key !== 'Shift' || event.repeat || !hovered?.closest || isExcluded(hovered)) return
    const block = postBody(hovered) || hovered.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote')
    if (!block || pendingHover.has(block) || entries.has(block)) return
    const group = sourceNodes('zh').find(item => item.block === block)
    if (!group) return
    const seq = hoverSeq
    pendingHover.add(block)
    try {
      const translated = await translateGroup(group, 'zh', () => seq === hoverSeq)
      if (!translated || seq !== hoverSeq || entries.has(block)) return
      insertEntry(group, translated, 'zh')
    } catch (error) { display('段落翻译'); status(error.message,true) }
    finally { pendingHover.delete(block) }
  })
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.command) return false
    if (message.command === 'get-state') { respond({ ok: true, state: { readingMode, target: currentTarget, autoTranslating: autoWatching } }); return false }
    if (message.readingMode) setReadingMode(message.readingMode)
    if (message.command === 'mode') { respond({ ok: true }); return false }
    if (message.command === 'activate') { display('WordMate 双语阅读'); status('已启用当前页：选中文字后点击翻译按钮；鼠标停在段落上按 Shift 可只翻译该段。') }
    else if (message.command === 'selection') translateSelection(message.text).catch(error => { display('翻译失败'); status(error.message, true) })
    else if (message.command === 'page') translatePage(message.target).catch(error => { pageRunning = false; display('翻译失败'); status(error.message, true) })
    else if (message.command === 'restore') restorePage()
    else if (message.command === 'cancel') cancelPage()
    else return false
    respond({ ok: true }); return false
  })
})()
