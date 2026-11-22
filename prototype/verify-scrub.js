
const fs=require('fs'); const path=require('path'); const os=require('os'); const {spawn}=require('child_process');
const PORT=9226; const BASE='file:///'+__dirname.replace(/\\/g,'/')+'/';
const edge=require('./browser').findBrowser();
const prof=fs.mkdtempSync(path.join(os.tmpdir(),'cvscrub-'));
const child=spawn(edge,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
  '--remote-debugging-port='+PORT,'--user-data-dir='+prof,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let list=null;
 for(let i=0;i<40;i++){ try{ list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); if(list.length) break; }catch(e){} await sleep(250); }
 const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise(r=>ws.onopen=r); let id=0; const p=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}};
 const send=(m2,params)=>new Promise((res,rej)=>{const i=++id;p.set(i,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id:i,method:m2,params}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,600)); return r.result.value;};
 const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(__dirname+'/'+n,Buffer.from(r.data,'base64'));};
 const mouse=async(type,x,y,extra)=>send('Input.dispatchMouseEvent',Object.assign({type,x,y,button:'left',clickCount:1},extra||{}));
 const drag=async(x1,y1,x2,y2,steps)=>{
  await mouse('mousePressed',x1,y1,{buttons:1});
  const n=steps||8;
  for(let i=1;i<=n;i++) await mouse('mouseMoved',x1+(x2-x1)*i/n,y1+(y2-y1)*i/n,{buttons:1});
  await mouse('mouseReleased',x2,y2,{buttons:0});
 };
 await send('Page.enable',{}); await send('Runtime.enable',{});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:620,deviceScaleFactor:1,mobile:false});

 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1200);
 const before=await ev("(function(){var r=document.getElementById('rail');var t=r.querySelector('.rail-thumb');var pb=r.getBoundingClientRect();var tb=t.getBoundingClientRect();var pv=document.getElementById('preview');" +
  "return {hidden:r.hidden,fixed:r.classList.contains('fixed'),overflow:pv.scrollHeight-pv.clientHeight,thumbH:Math.round(tb.height),thumbTop:Math.round(tb.top-pb.top),railH:Math.round(pb.height),val:r.getAttribute('aria-valuenow')};})()");
 console.log('rail@start:',JSON.stringify(before));

 const tb=await ev("(function(){var t=document.querySelector('#rail .rail-thumb').getBoundingClientRect();return {x:Math.round(t.x+4),y:Math.round(t.y+t.height/2)}})()");
 await drag(tb.x,tb.y,tb.x,tb.y+180);
 const afterDrag=await ev("(function(){var pv=document.getElementById('preview');return {top:Math.round(pv.scrollTop),val:document.getElementById('rail').getAttribute('aria-valuenow'),tip:document.querySelector('#rail .rail-tip').textContent}})()");
 console.log('after drag (real pointer):',JSON.stringify(afterDrag));
 await shot('shot-scrub.png');

 const geo=await ev("(function(){var r=document.getElementById('rail').getBoundingClientRect();return {x:Math.round(r.x+6),yBottom:Math.round(r.bottom)}})()");
 await mouse('mousePressed',geo.x,geo.yBottom-6,{buttons:1});
 await mouse('mouseReleased',geo.x,geo.yBottom-6,{buttons:0});
 await sleep(150);
 console.log('click track bottom:',JSON.stringify(await ev("(function(){var pv=document.getElementById('preview');return {top:Math.round(pv.scrollTop),max:pv.scrollHeight-pv.clientHeight,val:document.getElementById('rail').getAttribute('aria-valuenow')}})()")));

 await ev("document.getElementById('rail').focus()");
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35,nativeVirtualKeyCode:35});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35,nativeVirtualKeyCode:35});
 await sleep(200);
 const keyEnd=await ev("(function(){var pv=document.getElementById('preview');return {top:Math.round(pv.scrollTop),max:pv.scrollHeight-pv.clientHeight}})()");
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36,nativeVirtualKeyCode:36});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36,nativeVirtualKeyCode:36});
 await sleep(200);
 console.log('keyboard End:',JSON.stringify(keyEnd),'Home:',await ev("Math.round(document.getElementById('preview').scrollTop)"));

 await ev("document.getElementById('btn-align').click()"); await sleep(250);
 console.log('align pop open:',await ev("!document.getElementById('alignPop').hidden"),
   'rows:',await ev("JSON.stringify([].map.call(document.querySelectorAll('#alignPop .align-row'),function(r){return r.querySelector('.a-label').textContent}))"));
 const beforeX=await ev("Math.round(document.querySelector('#preview .msg.me').getBoundingClientRect().x)");
 await ev("(function(){var rows=document.querySelectorAll('#alignPop .align-row');var row=null;for(var i=0;i<rows.length;i++){if(rows[i].querySelector('.a-label').textContent.indexOf('我')===0){row=rows[i];break;}}" +
  "var bs=row.querySelectorAll('button');for(var j=0;j<bs.length;j++){if(bs[j].textContent==='右'){bs[j].click();break;}}return true;})()");
 await sleep(250);
 const afterX=await ev("(function(){var m=document.querySelector('#preview .msg.me');return {x:Math.round(m.getBoundingClientRect().x),cls:m.className,stored:localStorage.getItem('cv.display.v1')}})()");
 console.log('user bubble x:',beforeX,'->',afterX.x,'cls:',afterX.cls);
 console.log('stored:',afterX.stored);

 const blkBefore=await ev("JSON.stringify((function(){var w=document.querySelector('#preview .blk-wrap');if(!w)return null;return {cls:w.className,n:document.querySelectorAll('#preview .blk-wrap').length}})())");
 await ev("(function(){var rows=document.querySelectorAll('#alignPop .align-row');var row=null;for(var i=0;i<rows.length;i++){if(rows[i].querySelector('.a-label').textContent.indexOf('状态栏')>=0){row=rows[i];break;}}" +
  "var bs=row.querySelectorAll('button');for(var j=0;j<bs.length;j++){if(bs[j].textContent==='右'){bs[j].click();break;}}return true;})()");
 await sleep(250);
 const blkAfter=await ev("JSON.stringify((function(){var ws=document.querySelectorAll('#preview .blk-wrap');var right=[];for(var i=0;i<ws.length;i++){if(ws[i].classList.contains('side-right'))right.push(ws[i]);}" +
  "var msgs=document.querySelector('#preview .msgs').getBoundingClientRect();return {total:ws.length,right:right.length,first:right[0]?right[0].className:'-',gap:right[0]?Math.round(msgs.right-right[0].getBoundingClientRect().right):0}})())");
 console.log('block align:',blkBefore,'->',blkAfter);
 await shot('shot-align-blocks.png');

 await ev("document.getElementById('modeManual').click()"); await sleep(300);
 console.log('manual mode:',await ev("JSON.stringify({hint:!!document.querySelector('#form .ghost-btn'),popHidden:document.getElementById('alignPop').hidden})"));
 await ev("document.querySelector('#form .ghost-btn').click()"); await sleep(250);
 console.log('manual pop opens:',await ev("!document.getElementById('alignPop').hidden"));

 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1000);
 console.log('after reload:',JSON.stringify(await ev("(function(){var m=document.querySelector('#preview .msg.me');return {cls:m.className,x:Math.round(m.getBoundingClientRect().x),blkRight:document.querySelectorAll('#preview .blk-wrap.side-right').length}})()")));

 await ev("localStorage.removeItem('cv.display.v1')");
 await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1200);
 const m0=await ev("(function(){var r=document.getElementById('rail');var pv=document.getElementById('preview');return {hidden:r.hidden,fixed:r.classList.contains('fixed'),inner:pv.scrollHeight-pv.clientHeight,doc:document.documentElement.scrollHeight-innerHeight}})()");
 console.log('mobile rail:',JSON.stringify(m0));
 if(!m0.hidden){
  const mt=await ev("(function(){var t=document.querySelector('#rail .rail-thumb').getBoundingClientRect();return {x:Math.round(t.x+5),y:Math.round(t.y+t.height/2)}})()");
  await drag(mt.x,mt.y,mt.x,mt.y+220);
  console.log('mobile drag -> scrollY:',await ev("Math.round(window.scrollY)"));
  await shot('shot-scrub-mobile.png');
 }
 await ev("document.getElementById('btn-align').click()"); await sleep(250);
 console.log('mobile align pop:', await ev("(function(){var p=document.getElementById('alignPop');var r=p.getBoundingClientRect();return {open:!p.hidden,x:Math.round(r.x),right:Math.round(r.right),w:Math.round(r.width),vw:innerWidth,h:Math.round(r.height),vh:innerHeight,docW:document.documentElement.scrollWidth};})()"));
 await ev("document.querySelector('#alignPop .align-row button').click()"); await sleep(200);
 await shot('shot-align-mobile.png');
 await ev("document.getElementById('btn-align').click()"); await sleep(150);
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:620,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:BASE+'index.html?sample=cntags&mode=manual'}); await sleep(1200);
 await ev("(function(){var ss=document.querySelectorAll('#form select');for(var i=0;i<ss.length;i++){if(ss[i].value==='inline'){ss[i].value='standalone';ss[i].dispatchEvent(new Event('change'));break;}}return true;})()");
 await sleep(600);
 await ev("document.getElementById('btn-align').click()"); await sleep(200);
 await ev("(function(){['状态栏','内心','场景'].forEach(function(l){var rows=document.querySelectorAll('#alignPop .align-row');for(var i=0;i<rows.length;i++){var lab=rows[i].querySelector('.a-label').textContent;if(lab.indexOf(l)===0){var bs=rows[i].querySelectorAll('button');for(var j=0;j<bs.length;j++){if(bs[j].textContent==='右'){bs[j].click();break;}}break;}}});return true;})()");
 await sleep(400);
 console.log('standalone blocks:', await ev("(function(){var ws=[].slice.call(document.querySelectorAll('#preview .blk-wrap'));var c=document.querySelector('#preview .msgs').getBoundingClientRect();return {n:ws.length,parents:ws.map(function(w){return w.parentNode.className}),right:ws.filter(function(w){return w.classList.contains('side-right')}).map(function(w){return Math.round(w.getBoundingClientRect().x-c.x)})};})()"));

 console.log('errors:',await ev("JSON.stringify(window.__errs||[])"));
 ws.close(); child.kill();
 try{fs.rmSync(prof,{recursive:true,force:true});}catch(e){}
})().catch(e=>{console.log('ERR',e.message); try{child.kill();}catch(x){} process.exit(1);});
