
const fs=require('fs'); const path=require('path'); const os=require('os'); const {spawn}=require('child_process');
const PORT=9223; const BASE='file:///'+__dirname.replace(/\\/g,'/')+'/';
const edge=require('./browser').findBrowser();
const prof=fs.mkdtempSync(path.join(os.tmpdir(),'cvalign-'));
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
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,500)); return r.result.value;};
 const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(__dirname+'/'+n,Buffer.from(r.data,'base64'));};
 await send('Page.enable',{}); await send('Runtime.enable',{});
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});

 const measure = "(function(){var list=[].slice.call(document.querySelectorAll('#preview .msg'));var cont=document.querySelector('#preview .msgs').getBoundingClientRect();" +
  "return list.map(function(m){var r=m.getBoundingClientRect();return {who:m.querySelector('.who').textContent,cls:m.className,left:Math.round(r.x-cont.x),rightGap:Math.round(cont.right-r.right),w:Math.round(r.width)};});})()";
 const setRow = function(label,side){ return "(function(){var rows=document.querySelectorAll('#alignPop .align-row');var row=null;" +
  "for(var i=0;i<rows.length;i++){if(rows[i].querySelector('.a-label').textContent.indexOf(" + JSON.stringify(label) + ")===0){row=rows[i];break;}}" +
  "if(!row)return 'no-row';var bs=row.querySelectorAll('button');for(var j=0;j<bs.length;j++){if(bs[j].textContent===" + JSON.stringify(side) + "){bs[j].click();return 'ok';}}return 'no-btn';})()"; };

 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(900);
 await ev("localStorage.clear()");
 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1000);
 const auto = await ev(measure);
 console.log('stdiv auto:', JSON.stringify(auto));
 await shot('shot-align-stdiv.png');

 await ev("document.getElementById('btn-align').click()"); await sleep(200);
 console.log('user->right:', await ev(setRow('我','右')), 'assistant->left:', await ev(setRow('AI','左')));
 await ev("document.getElementById('alignPop').hidden=true");
 await sleep(300);
 console.log('after swap:', JSON.stringify(await ev(measure)));
 await shot('shot-align-swapped.png');

 console.log('after reset:', await ev("(function(){document.getElementById('btn-align').click();document.getElementById('alignReset').click();return localStorage.getItem('cv.display.v1');})()"),
   'sides:', JSON.stringify(await ev(measure)));
 await sleep(300);

 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv&mode=manual'}); await sleep(1000);
 console.log('manual hints:', await ev("JSON.stringify([].map.call(document.querySelectorAll('#form .ghost-btn'),function(b){return b.textContent.trim()}))"));
 console.log('manual sides:', JSON.stringify(await ev(measure)));
 await shot('shot-align-manual.png');

 await send('Page.navigate',{url:BASE+'index.html?sample=chatgpt'}); await sleep(1000);
 console.log('chatgpt auto:', JSON.stringify(await ev(measure)));
 await shot('shot-align-json.png');
 console.log('page errors:', await ev("JSON.stringify(window.__errs||[])"));
 ws.close(); child.kill();
 try{fs.rmSync(prof,{recursive:true,force:true});}catch(e){}
})().catch(e=>{console.log('ERR',e.message); try{child.kill();}catch(x){} process.exit(1);});
