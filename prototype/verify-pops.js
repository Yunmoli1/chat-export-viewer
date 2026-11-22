
const fs=require('fs'); const path=require('path'); const os=require('os'); const {spawn}=require('child_process');
const PORT=9228; const BASE='file:///'+__dirname.replace(/\\/g,'/')+'/';
const edge=require('./browser').findBrowser();
const prof=fs.mkdtempSync(path.join(os.tmpdir(),'cvpops-'));
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

 // 在弹层里取若干点，看 elementFromPoint 命中的是不是弹层自己（被正文盖住就会命中 .msg）
 const probe = "(function(id){var p=document.getElementById(id);if(p.hidden)return 'hidden';var r=p.getBoundingClientRect();" +
  "var pts=[[r.x+r.width/2,r.y+8],[r.x+r.width/2,r.y+r.height/2],[r.x+r.width-12,r.y+r.height-14]];" +
  "var bad=[];pts.forEach(function(pt){var e=document.elementFromPoint(pt[0],pt[1]);if(!e||!p.contains(e)){bad.push({x:Math.round(pt[0]),y:Math.round(pt[1]),hit:e?e.className+'|'+e.tagName:'null'});}});" +
  "return {rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},bad:bad};})(%IDS%)";
 const check = id=>ev(probe.replace('%IDS%', JSON.stringify(id)));

 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1100);
 await ev("document.getElementById('btn-align').click()"); await sleep(250);
 console.log('desktop alignPop:', JSON.stringify(await check('alignPop')));
 await shot('shot-pop-align.png');
 await ev("document.getElementById('alignPop').hidden=true;document.getElementById('btn-files').click()"); await sleep(250);
 console.log('desktop filesPop:', JSON.stringify(await check('filesPop')));
 await shot('shot-pop-files.png');
 // 反证：还原成修复前的写法（header 静态、不抬层），探针必须发现弹层跑到视口外/被盖住
 await ev("document.getElementById('filesPop').hidden=true;var h=document.querySelector('header');h.style.position='static';h.style.zIndex='auto';document.getElementById('btn-align').click()");
 await sleep(250);
 console.log('guard desktop (header static):', JSON.stringify(await check('alignPop')), 'popTop=', await ev("Math.round(document.getElementById('alignPop').getBoundingClientRect().y)"));
 await ev("var h=document.querySelector('header');h.style.position='';h.style.zIndex='';document.getElementById('alignPop').hidden=true");

 await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
 await send('Page.navigate',{url:BASE+'index.html?sample=stdiv'}); await sleep(1100);
 await ev("document.getElementById('btn-align').click()"); await sleep(250);
 console.log('mobile alignPop:', JSON.stringify(await check('alignPop')));
 await shot('shot-pop-mobile.png');
 await ev("document.getElementById('alignPop').hidden=true;document.getElementById('btn-files').click()"); await sleep(250);
 console.log('mobile filesPop:', JSON.stringify(await check('filesPop')));
 console.log('page errors:', await ev("JSON.stringify(window.__errs||[])"));
 ws.close(); child.kill();
 try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:3});}catch(e){}
})().catch(e=>{console.log('ERR',e.message); try{child.kill();}catch(x){} process.exit(1);});