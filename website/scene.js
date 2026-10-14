/* Product scenario reconstruction. No model requests, real keystrokes or messages are sent. */
(()=>{
 const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let step=0,tick=0,playing=!reduced,timer,visible=true;
 const frames=[
 {draft:'I want to eat ',typed:true,mode:'英',key:['英文键盘','English mode'],hint:['想回复英文，但暂时想不起“早餐”。','You want to reply in English, but cannot recall “早餐”.'],caption:['英文模式正常输入，Space 就是空格。','Type normally in English mode. Space inserts a space.']},
 {draft:'I want to eat ',pinyin:'zao’can',candidate:'早餐',translation:'n. breakfast',other:'2  早参\n3  早灿',mode:'中',key:['Shift → zaocan','Shift → zaocan'],hint:['不用离开聊天框，切换中文输入。','Switch to Chinese without leaving the chat box.'],caption:['按 Shift 切到中文，再输入 zaocan，查看“早餐”候选。','Tap Shift, type zaocan, and see the Chinese candidate for breakfast.']},
 {draft:'I want to eat ',marked:'早餐',pinyin:'I want to eat 早餐',candidate:'I want to eat 早餐',translation:'',mode:'中',key:['Tab','Tab'],hint:['保持在草稿中，先不确认上屏。','Keep the composition editable before confirming.'],caption:['Tab 将中文候选纳入可编辑草稿，为整句翻译留出机会。','Tab adds the Chinese candidate to the editable draft, ready for sentence translation.']},
 {draft:'I want to eat ',marked:'早餐',pinyin:'I want to eat 早餐',candidate:'I want to eat 早餐',translation:'I want to eat breakfast',mode:'中',key:['整句译文','Sentence translation'],hint:['译文显示在对应候选句子的下面。','The translation appears below its source candidate.'],caption:['英文译文出现在候选句下方，原文保留，等你确认。','The English translation sits below the candidate. The source stays until you confirm.']},
 {draft:'I want to eat breakfast',mode:'英',key:['⌥ Space','⌥ Space'],hint:['只写入输入框，不触发聊天发送。','Insert into the composer without sending the message.'],caption:['按 Option + Space 采用英文，早餐变为 breakfast。','Press Option + Space to adopt the English translation. 早餐 becomes breakfast.']},
 {draft:'I want to eat breakfast before the meeting.',typed:true,mode:'英',key:['继续输入','Keep typing'],hint:['句子仍在输入框中，可以编辑或自行发送。','The message is still a draft. Edit it or send it yourself.'],caption:['回到英文输入继续补充；候选已关闭，前文也可以修改。','Continue in English. The candidate window closes and the earlier text can be edited.']}
 ];
 function en(){return document.documentElement.lang==='en'}
 function render(){const f=frames[step],e=en(),choose=a=>a[e?1:0];
 $('sceneContext').textContent=e?'USE CASE / Breakfast with a colleague':'使用场景 / 和同事约早餐';$('sceneStatus').textContent=e?'Work chat':'工作聊天';$('sceneHint').textContent=choose(f.hint);$('sceneCaption').textContent=choose(f.caption);$('sceneKey').textContent=choose(f.key);$('sceneCounter').textContent=`0${step+1} / 06`;$('sceneMode').textContent=f.mode;
 const draft=$('sceneDraft');draft.replaceChildren();let text=f.draft;if(f.typed&&playing)text=text.slice(0,Math.min(text.length,Math.floor(tick/2)));draft.append(document.createTextNode(text));if(f.marked){const mark=document.createElement('mark');mark.textContent=f.marked;draft.append(mark)}const caret=document.createElement('span');caret.className='scene-caret';draft.append(caret);
 $('sceneIME').hidden=!f.candidate;$('scenePreedit').textContent=f.pinyin||'';$('sceneCandidate').textContent=f.candidate||'';$('sceneTranslation').textContent=f.translation||'';$('sceneTranslation').hidden=!f.translation;$('sceneOther').textContent=f.other||'';$('sceneShortcuts').textContent=e?'Space original · ⌥Space English · Tab draft space':'Space 上屏 · ⌥Space 英文 · Tab 草稿空格';
 $('scenePlay').textContent=playing?(e?'Pause':'暂停'):(e?'Play':'播放');$('scenePlay').setAttribute('aria-pressed',String(playing));$('sceneReplay').textContent=e?'Replay ↺':'重播 ↺';$('sceneDisclosure').textContent=e?'Animated usage scenario · insert on confirmation, never auto-send':'聊天输入场景动画 · 确认后上屏，不自动发送';
 [...$('sceneSteps').children].forEach((b,i)=>{b.setAttribute('aria-current',String(step===i));b.setAttribute('aria-label',e?`Step ${i+1}`:`第 ${i+1} 步`)});
 }
 function schedule(){clearInterval(timer);if(!playing)return;timer=setInterval(()=>{if(!visible||document.hidden)return;tick++;const duration=step===0?65:step===5?110:40;if(tick>=duration){step=(step+1)%frames.length;tick=0}render()},100)}
 function select(i){step=i;tick=120;playing=false;schedule();render()}
 frames.forEach((_,i)=>{const b=document.createElement('button');b.type='button';b.addEventListener('click',()=>select(i));$('sceneSteps').append(b)});
 $('scenePlay').addEventListener('click',()=>{playing=!playing;if(playing)tick=0;render();schedule()});$('sceneReplay').addEventListener('click',()=>{step=0;tick=0;playing=true;render();schedule()});
 new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});new IntersectionObserver(entries=>{visible=entries[0].isIntersecting}).observe($('heroScene'));window.WordMateScene={getState:()=>({step,playing}),select};render();schedule();
})();
