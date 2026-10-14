const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), vm = require('vm'), crypto = require('crypto')
const source = fs.readFileSync(require.resolve('../browser-extension/background.js'),'utf8')
function setup(fail = false, url = 'https://example.com/article') {
  const events={}, created=[], requests=[], commands=[]
  const chrome = {
    runtime: { id:'test-extension', getURL:path=>'chrome-extension://test-extension/'+path, onInstalled:{addListener:fn=>events.install=fn}, onMessage:{addListener:fn=>events.message=fn},
      connectNative:()=>{
        let reply, disconnect
        return { onMessage:{addListener:fn=>reply=fn},onDisconnect:{addListener:fn=>disconnect=fn},disconnect:()=>{},
          postMessage:message=>{requests.push(message);queueMicrotask(()=>reply(fail?{ok:false,error:'host missing'}:{ok:true,result:{translation:'你好'}}))} }
      } },
    contextMenus:{removeAll:fn=>fn(),create:options=>created.push(options),onClicked:{addListener:fn=>events.click=fn}},
    scripting:{executeScript:async options=>commands.push(options)},
    tabs:{get:async id=>({id,url}),update:async (id,options)=>commands.push({updated:id,opened:options.url}),sendMessage:async (tabId,message,options)=>{commands.push({tabId,message,options});return {ok:true}}},
    action:{setBadgeText:async ()=>{},setTitle:async ()=>{}},
  }
  vm.runInNewContext(source,{chrome,setTimeout,clearTimeout,URL,URLSearchParams})
  return {events,created,requests,commands}
}
test('selection context menu injects webpage renderer into the selected frame',async()=>{
 const s=setup();s.events.install()
 assert.equal(s.created.length,4)
 await s.events.click({menuItemId:'translate',selectionText:'Hello 世界',frameId:3},{id:7})
 assert.equal(s.commands[0].target.frameIds[0],3)
 assert.equal(s.commands[1].message.text,'Hello 世界')
 assert.equal(s.commands[1].message.command,'selection')
})
test('page and restore commands use the page renderer',async()=>{
 const s=setup()
 await s.events.click({menuItemId:'page'},{id:7})
 await s.events.click({menuItemId:'restore'},{id:7})
 assert.equal(s.commands[1].message.command,'page')
 assert.equal(s.commands[3].message.command,'restore')
})
test('content request returns native result rather than opens a desktop URL',async()=>{
 const s=setup()
 const result=await new Promise(resolve=>s.events.message({type:'translate-text',action:'page',text:'Hello',target:'en'},{tab:{id:7}},resolve))
 assert.equal(result.result.translation,'你好')
 assert.equal(s.requests[0].action,'page')
 assert.equal(s.requests[0].target,'en')
})
test('native errors are returned to webpage for retry',async()=>{
 const s=setup(true)
 const result=await new Promise(resolve=>s.events.message({type:'translate-text',action:'selection',text:'Hello'},{tab:{id:7}},resolve))
 assert.equal(result.ok,false);assert.match(result.error,/host missing/)
})
test('extension ID stays stable with active-tab-only injection',()=>{
 const manifest=require('../browser-extension/manifest.json')
 const id=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).split('').map(c=>String.fromCharCode(97+parseInt(c,16))).join('')
 assert.ok(fs.readFileSync(require.resolve('../scripts/install-browser-host.py'),'utf8').includes(id))
 assert.ok(manifest.permissions.includes('activeTab'))
 assert.equal(manifest.host_permissions,undefined)
})

test('explicit PDF command opens the bundled reader without injection',async()=>{
 const s=setup();const result=await new Promise(resolve=>s.events.message({type:'command',command:'pdf',tabId:7},{},resolve))
 assert.equal(result.ok,true);assert.match(s.commands[0].opened,/pdf-reader.html\?/);assert.equal(s.commands.length,1);assert.equal(s.commands[0].updated,7);assert.match(s.commands[0].opened,/autoload=1/)
})
test('PDF link menu forwards the link instead of the surrounding webpage',async()=>{
 const s=setup();await s.events.click({menuItemId:'pdf',linkUrl:'https://example.org/report.pdf'},{id:7})
 assert.equal(new URL(s.commands[0].opened).searchParams.get('source'),'https://example.org/report.pdf');assert.equal(s.commands[0].updated,7)
})
test('reader extension document can translate without sender.tab',async()=>{
 const s=setup();const result=await new Promise(resolve=>s.events.message({type:'translate-text',action:'page',text:'Report'},{id:'test-extension',url:'chrome-extension://test-extension/pdf-reader.html'},resolve))
 assert.equal(result.ok,true);assert.equal(s.requests[0].text,'Report')
})

test('page translation on a PDF takes over the same tab and carries target/mode',async()=>{
 const s=setup(false,'https://example.com/paper.pdf');await s.events.click({menuItemId:'page'},{id:7,url:'https://example.com/paper.pdf'})
 assert.equal(s.commands[0].updated,7);const url=new URL(s.commands[0].opened)
 assert.equal(url.searchParams.get('source'),'https://example.com/paper.pdf');assert.equal(url.searchParams.get('autoload'),'1')
})
test('PDF command inside the current reader keeps the document instead of reopening an empty view',async()=>{
 const s=setup(false,'chrome-extension://test-extension/pdf-reader.html?source=https%3A%2F%2Fexample.com%2Fa.pdf')
 const result=await new Promise(resolve=>s.events.message({type:'command',command:'pdf',tabId:7},{},resolve))
 assert.equal(result.ok,true);assert.equal(s.commands.length,1);assert.equal(s.commands[0].message.command,'pdf');assert.equal(s.commands[0].opened,undefined)
})
