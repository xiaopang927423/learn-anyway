import * as pdfjs from './vendor/pdfjs/build/pdf.mjs'
import { paragraphs, chunks, remotePdfUrl } from './pdf-model.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href
const $ = id => document.getElementById(id)
let documentTask, pdf, documentSeq = 0, renderSeq = 0, translationSeq = 0, selectionSeq = 0
let currentPage = 1, currentBlocks = [], scale = 1, renderTask, textLayer, pageBusy = false
const pageCache = new Map(), translations = new Map(), failures = new Map()
let selectionInput
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error',error) }
function node(tag, text, className) { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element }
async function request(action, text, context = '', target = $('target').value) {
  const response = await chrome.runtime.sendMessage({ type:'translate-text', action, text, context, target })
  if (!response?.ok) throw new Error(response?.error || '翻译失败，请运行 WordMate 并安装浏览器连接。')
  return response.result
}
function cacheKey(block, page = currentPage, target = $('target').value) { return `${page}:${target}:${block.id}` }
function stop() { translationSeq++; pageBusy = false; $('translate-page').disabled = !pdf; status('已停止，已完成的译文保留。') }
function highlight(block) {
  $('highlights').replaceChildren()
  for (const rect of block.rects) {
    const box = node('div',null,'highlight')
    Object.assign(box.style,{left:rect.x * scale + 'px',top:rect.y * scale + 'px',width:rect.width * scale + 'px',height:rect.height * scale + 'px'})
    $('highlights').append(box)
  }
  const first = $('highlights').firstChild
  if (first) first.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' })
  for (const element of $('paragraphs').children) element.classList.toggle('active',element.dataset.id === String(block.id))
}
function drawParagraphs() {
  const selected = $('paragraphs').querySelector('.active')?.dataset.id
  $('paragraphs').replaceChildren()
  $('reading').classList.toggle('translated',$('mode').value === 'translated')
  for (const block of currentBlocks) {
    const key = cacheKey(block), translation = translations.get(key)
    const card = node('article',null,'paragraph'); card.dataset.id = block.id; card.tabIndex = 0
    card.append(node('header',`第 ${currentPage} 页 · 段落 ${block.id + 1}`),node('p',block.text,'source'))
    card.append(node('p',translation || '尚未翻译','translation'))
    // In translated mode keep untranslated originals visible so content never disappears.
    if (!translation) card.querySelector('.source').style.display = 'block'
    if (failures.has(key)) card.append(node('p',failures.get(key),'error'))
    const control = node('button',failures.has(key) ? '重试该段' : translation ? '定位原文' : '翻译该段')
    control.onclick = event => { event.stopPropagation(); if (translation) highlight(block); else translatePage([block]) }
    card.append(control)
    card.onclick = () => highlight(block)
    card.onkeydown = event => { if (event.target === card && ['Enter',' '].includes(event.key)) { event.preventDefault(); highlight(block) } }
    if (String(block.id) === selected) card.classList.add('active')
    $('paragraphs').append(card)
  }
}
async function translatePage(blocks = currentBlocks) {
  if (!pdf || !blocks.length || pageBusy) return
  const token = ++translationSeq, docToken = documentSeq, page = currentPage, target = $('target').value
  const valid = () => token === translationSeq && docToken === documentSeq
  pageBusy = true; $('translate-page').disabled = true
  let completed = 0, failed = 0, cursor = 0
  const pending = blocks.filter(block => !translations.has(cacheKey(block,page,target)))
  async function worker() {
    while (cursor < pending.length && valid()) {
      const block = pending[cursor++], key = cacheKey(block,page,target)
      try {
        let output = ''
        for (const chunk of chunks(block.text)) {
          if (!valid()) return
          const result = await request('page',chunk,'',target)
          if (!valid()) return
          if (typeof result.translation !== 'string' || !result.translation.trim()) throw new Error('模型未返回有效译文，请重试。')
          output += result.translation
        }
        if (!valid()) return
        translations.set(key,output); failures.delete(key); completed++
      } catch (error) { if (!valid()) return; failures.set(key,error.message); failed++ }
      if (valid()) { drawParagraphs(); status(`第 ${page} 页：${completed} 段完成，${failed} 段失败；待处理 ${pending.length - completed - failed} 段。`,failed > 0) }
    }
  }
  await Promise.all([worker(),worker()])
  if (!valid()) return
  pageBusy = false; $('translate-page').disabled = false
  status(pending.length ? `第 ${page} 页翻译完成：${completed} 段成功，${failed} 段失败。${failed ? '可点击失败段落重试。' : '点击段落可定位原文。'}` : '当前页已翻译，无需重复请求。',failed > 0)
}
async function showPage(number = currentPage) {
  if (!pdf) return
  stop(); const token = ++renderSeq, docToken = documentSeq, activePdf = pdf
  const previousRender = renderTask; previousRender?.cancel(); textLayer?.cancel()
  currentPage = Math.max(1,Math.min(activePdf.numPages,Number(number) || 1))
  const pageNumber = currentPage
  $('page-number').value = pageNumber; $('page-count').textContent = `/ ${activePdf.numPages}`
  $('previous').disabled = pageNumber === 1; $('next').disabled = pageNumber === activePdf.numPages
  $('translate-page').disabled = true; currentBlocks = []; $('paragraphs').replaceChildren(); $('highlights').replaceChildren(); $('text-layer').replaceChildren()
  status(`正在读取第 ${pageNumber} 页…`)
  const valid = () => token === renderSeq && docToken === documentSeq
  try {
    if (previousRender) await previousRender.promise.catch(() => {})
    if (!valid()) return
    const page = await activePdf.getPage(pageNumber)
    if (!valid()) return
    scale = Number($('zoom').value)
    const viewport = page.getViewport({scale}), base = page.getViewport({scale:1})
    const canvas = $('canvas'), ratio = Math.min(devicePixelRatio || 1,2,4096 / viewport.width,4096 / viewport.height)
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px'
    $('page').style.width = viewport.width + 'px'; $('page').style.height = viewport.height + 'px'
    $('page').style.setProperty('--scale-factor',scale); $('page').style.setProperty('--total-scale-factor',scale)
    renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio === 1 ? null : [ratio,0,0,ratio,0,0]})
    // Await canvas cancellation before a subsequent renderer can use it.
    await renderTask.promise
    if (!valid()) return
    const content = await page.getTextContent()
    if (!valid()) return
    if (!pageCache.has(pageNumber)) pageCache.set(pageNumber,paragraphs(content.items,base,pdfjs.Util.transform))
    currentBlocks = pageCache.get(pageNumber)
    textLayer = new pdfjs.TextLayer({textContentSource:content,container:$('text-layer'),viewport})
    await textLayer.render()
    if (!valid()) return
    $('empty').hidden = true; $('translate-page').disabled = !currentBlocks.length
    drawParagraphs()
    status(currentBlocks.length ? `第 ${pageNumber} 页，${currentBlocks.length} 个文字段落。可选词翻译，或点击“翻译当前页”。复杂表格与多栏阅读顺序请对照原版页面。` : '本页没有可提取文字，可能是扫描件或图片。本版不含 OCR。')
    if ($('auto').checked && currentBlocks.length) await translatePage()
  } catch (error) { if (valid() && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') status('读取页面失败：' + error.message,true) }
}
async function loadPdf(data, name) {
  const token = ++documentSeq
  stop(); ++renderSeq; ++selectionSeq; $('selection-panel').hidden = true
  renderTask?.cancel(); textLayer?.cancel()
  const old = documentTask; documentTask = null; pdf = null
  pageCache.clear(); translations.clear(); failures.clear(); currentBlocks = []
  $('paragraphs').replaceChildren(); $('text-layer').replaceChildren(); $('highlights').replaceChildren()
  $('canvas').width = 0; $('page').style.height = '0px'; $('page-number').disabled = true
  $('previous').disabled = $('next').disabled = $('translate-page').disabled = true
  status('正在打开：' + name)
  try {
    if (old) await old.destroy()
    if (token !== documentSeq) return
    const task = pdfjs.getDocument({ data, cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
      standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href,
      iccUrl:new URL('./vendor/pdfjs/iccs/',import.meta.url).href,isEvalSupported:false })
    documentTask = task
    const loaded = await task.promise
    if (token !== documentSeq) return
    pdf = loaded
    document.title = `${name} · WordMate PDF`; $('page-number').disabled = false; $('page-number').max = pdf.numPages
    await showPage(1)
  } catch (error) { if (token === documentSeq) { pdf = null; status(error.name === 'PasswordException' ? '此 PDF 需要密码，请先解锁后重新打开。' : '无法打开 PDF：' + error.message,true) } }
}
let fetchController, openSeq = 0
async function openRemote(userGesture = true) {
  const token = ++openSeq
  fetchController?.abort(); fetchController = new AbortController()
  const controller = fetchController, timeout = setTimeout(() => controller.abort(),60000)
  $('open-url').disabled = true
  try {
    const url = remotePdfUrl($('url').value)
    const permission = {origins:[url.origin + '/*']}
    if (!await chrome.permissions.contains(permission)) {
      if (!userGesture || !await chrome.permissions.request(permission)) { $('open-controls').hidden = false; throw new Error('未授予该站点读取权限。点击“打开地址”授权，或用本地文件打开。') }
    }
    if (token !== openSeq) return
    status('正在下载 PDF…')
    const response = await fetch(url.href,{signal:controller.signal,credentials:'omit'})
    if (!response.ok) throw new Error(`HTTP ${response.status}；需登录的文件请下载后打开。`)
    if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，请下载后本地打开。')
    const reader = response.body.getReader(), parts = []; let size = 0
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 100 * 1024 * 1024) { await reader.cancel(); throw new Error('文件超过 100 MB，请下载后本地打开。') } parts.push(value) }
    if (token !== openSeq) return
    const data = new Uint8Array(size); let offset = 0; for (const part of parts) { data.set(part,offset); offset += part.length }
    await loadPdf(data,decodeURIComponent(url.pathname.split('/').at(-1) || '网络 PDF'))
  } catch (error) { if (token === openSeq) { $('open-controls').hidden = false; status('打开失败：' + (error.name === 'AbortError' ? '下载超时或已取消，请重试。' : error.message),true) } }
  finally { clearTimeout(timeout); if (token === openSeq) $('open-url').disabled = false }
}
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return
  const token = ++openSeq; fetchController?.abort(); $('open-url').disabled = false
  if (file.size > 100 * 1024 * 1024) { status('本版支持最大 100 MB 的 PDF。',true); return }
  try { const data = new Uint8Array(await file.arrayBuffer()); if (token === openSeq) await loadPdf(data,file.name) }
  catch (error) { if (token === openSeq) status('文件读取失败：' + error.message,true) }
  finally { event.target.value = '' }
}
$('open-url').onclick = () => openRemote(true)
$('previous').onclick = () => showPage(currentPage - 1)
$('next').onclick = () => showPage(currentPage + 1)
$('page-number').onchange = () => showPage($('page-number').value)
$('zoom').onchange = () => showPage()
$('target').onchange = () => { stop(); drawParagraphs(); if ($('auto').checked) translatePage() }
$('mode').onchange = drawParagraphs
$('translate-page').onclick = () => translatePage()
$('stop').onclick = () => { $('auto').checked = false; stop() }
$('restore').onclick = () => { $('auto').checked = false; stop(); translations.clear(); failures.clear(); drawParagraphs(); status('已清除阅读器译文，原版 PDF 保留。') }
$('close-selection').onclick = () => { ++selectionSeq; $('selection-panel').hidden = true }
async function translateSelection() {
  const selection = window.getSelection(), text = selection?.toString().trim()
  if (!text || text.length > 12000) { status('请先选中 1–12000 字符的原文或右侧文字。',true); return }
  const parent = selection.anchorNode?.parentElement
  if (parent?.closest('header,nav,#selection-panel')) return
  const context = (parent?.closest('.paragraph')?.querySelector('.source')?.textContent || currentBlocks.find(block => block.text.includes(text))?.text || '').slice(0,4000)
  const token = ++selectionSeq, docToken = documentSeq
  selectionInput = {text,context}; $('selection-panel').hidden = false; $('selection-result').textContent = '正在翻译…'; $('add-word').hidden = true
  try {
    const result = await request('selection',text,context,'zh')
    if (token !== selectionSeq || docToken !== documentSeq) return
    $('selection-result').textContent = result.type === 'word' ? [result.word || text,result.phonetic_us,result.phonetic_uk,...(result.definitions || []).map(item => `${item.pos || ''} ${item.meaning || ''}`),...(result.examples || []).map(item => `${item.en || ''}\n${item.zh || ''}`),result.notes].filter(Boolean).join('\n') : result.translation || '未返回译文'
    const word = result.notebookWord || (result.type === 'word' ? result.word || text : '')
    if (word) { $('add-word').hidden = false; $('add-word').disabled = result.inNotebook === true; $('add-word').textContent = result.inNotebook ? `✓ ${word} 已收录` : `加入生词本：${word}` }
    if (result.notebookError) $('selection-result').append(node('p',result.notebookError,'error'))
  } catch (error) { if (token === selectionSeq) $('selection-result').textContent = error.message }
}
$('translate-selection').onclick = translateSelection
$('text-layer').addEventListener('mouseup',() => { if (window.getSelection()?.toString().trim()) translateSelection() })
$('text-layer').addEventListener('click',event => {
  if (window.getSelection()?.toString().trim()) return
  const bounds = $('page').getBoundingClientRect(), x = (event.clientX - bounds.left) / scale, y = (event.clientY - bounds.top) / scale
  const block = currentBlocks.find(block => block.rects.some(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height))
  if (block) { highlight(block); $('paragraphs').querySelector(`[data-id="${block.id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}) }
})
$('add-word').onclick = async () => {
  if (!selectionInput) return
  const token = selectionSeq, input = {...selectionInput}; $('add-word').disabled = true
  try { const result = await request('add-word',input.text,input.context,'zh'); if (token !== selectionSeq) return; if (!result.inNotebook) throw new Error('尚未确认收录，请重试。'); $('add-word').textContent = `✓ ${result.notebookWord || input.text} 已收录` }
  catch (error) { if (token === selectionSeq) { $('add-word').disabled = false; $('selection-result').append(node('p',error.message,'error')) } }
}
$('change-file').onclick = () => { $('open-controls').hidden = !$('open-controls').hidden }
const params = new URLSearchParams(location.search)
if (['zh','en'].includes(params.get('target'))) $('target').value = params.get('target')
if (['bilingual','translated'].includes(params.get('mode'))) $('mode').value = params.get('mode')
const source = params.get('source')
if (source) {
  try {
    const url = remotePdfUrl(source).href; $('url').value = url
    $('return-original').hidden = false; $('return-original').onclick = () => { stop(); location.href = url }
    if (params.get('autoload') === '1') {
      $('open-controls').hidden = true; $('auto').checked = true
      openRemote(false)
    } else status('已填入当前 PDF 地址，点击“打开地址”读取。')
  } catch (error) { status(error.message,true) }
}
chrome.runtime.onMessage?.addListener((message,sender,respond) => {
  if (!message.command) return false
  if (message.target && ['zh','en'].includes(message.target) && message.target !== $('target').value) { stop(); $('target').value = message.target; drawParagraphs() }
  if (message.readingMode && ['bilingual','translated'].includes(message.readingMode)) { $('mode').value = message.readingMode; drawParagraphs() }
  if (message.command === 'page' || message.command === 'pdf') translatePage()
  else if (message.command === 'selection') translateSelection()
  else if (message.command === 'cancel') $('stop').click()
  else if (message.command === 'restore') $('restore').click()
  respond({ok:true,state:{readingMode:$('mode').value,target:$('target').value,autoTranslating:$('auto').checked}})
  return false
})
