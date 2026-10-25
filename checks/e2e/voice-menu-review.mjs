// Actual web settings, sample data and mocked RPCs. Nothing reaches the live service.
import assert from 'node:assert/strict';
import {fs,path,makeDb,phone,open,browser,server,sleep} from './harness.mjs';
const dir=process.env.VOICE_SHOTS; if(!dir || !path.isAbsolute(dir)) throw Error('Set VOICE_SHOTS');
fs.mkdirSync(dir,{recursive:true});
const db=makeDb();db.company.brand={theme:'ops',colour:'#F9A01B',short:'TakeOff',calls:true,texts:true,voice:true};db.company.calls={on:true};
const realtime=async(page)=>page.context().routeWebSocket('**/realtime/v1/websocket*',socket=>{
 socket.onMessage(raw=>{
  try {
   const m=JSON.parse(String(raw)), array=Array.isArray(m);
   const [joinRef,ref,topic,event,payload]=array?m:[m.join_ref,m.ref,m.topic,m.event,m.payload];
   if(event!=='phx_join' && event!=='heartbeat') return;
   const response=event==='phx_join'?{postgres_changes:(payload.config?.postgres_changes||[]).map((x,i)=>({...x,id:i+1}))}:{};
   const body={status:'ok',response};
   socket.send(JSON.stringify(array?[joinRef,ref,topic,'phx_reply',body]:{join_ref:joinRef,ref,topic,event:'phx_reply',payload:body}));
  } catch(e) { console.error(e.message); }
 });
});

let state={configured:true,approved:true,app_ready:true,on:false,greeting:'Welcome to TakeOff parking.'},saved;
try {
 const page=await phone(browser,db,{width:420});await page.setViewportSize({width:420,height:940});
 await page.context().route('**/rest/v1/rpc/voice_menu_settings',r=>r.fulfill({json:state}));
 await page.context().route('**/rest/v1/rpc/set_voice_menu',r=>{saved=r.request().postDataJSON();state={...state,on:saved.p_on,greeting:saved.p_greeting};return r.fulfill({json:state})});
 await realtime(page);await open(page);
 await page.evaluate(()=> (document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());
 await page.waitForSelector('#menu[open]');await page.click('#menuBody [data-view="settings"]');await sleep(200);
 if(await page.$('[data-settab="texts"]')) await page.click('[data-settab="texts"]');
 if(await page.$('[data-setsec="calls"]')) await page.click('[data-setsec="calls"]');
 await page.waitForSelector('#vmOn');await page.locator('#voiceMenu').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('#vmOn').inputValue(),'false');
 await page.selectOption('#vmOn','true');await page.fill('#vmGreeting','Welcome to TakeOff.');await page.click('[data-savevoice]');await sleep(150);
 assert.deepEqual(saved,{p_on:true,p_greeting:'Welcome to TakeOff.'});
 assert.equal(await page.locator('#vmOn').inputValue(),'true');
 await sleep(4500);await page.locator('#voiceMenu').evaluate(e=>e.scrollIntoView({block:'center'}));
 await page.screenshot({path:path.join(dir,'Caller_Menu_Settings.png')});
 state={configured:false,approved:false,app_ready:false,on:false,greeting:''};
 // A fresh settings render must show an honest setup state with no enable control.
 await page.reload();await open(page);
 await page.evaluate(()=> (document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());
 await page.waitForSelector('#menu[open]');await page.click('#menuBody [data-view="settings"]');await sleep(200);
 if(await page.$('[data-settab="texts"]')) await page.click('[data-settab="texts"]');
 if(await page.$('[data-setsec="calls"]')) await page.click('[data-setsec="calls"]');
 await page.waitForSelector('#voiceMenu');await sleep(100);assert.match(await page.locator('#voiceMenu').innerText(),/Not set up/);assert.equal(await page.locator('#vmOn').count(),0);
 // Add-on off (brand.voice missing): the caller menu is not offered at all.
 db.company.brand={theme:'ops',colour:'#F9A01B',short:'TakeOff',calls:true,texts:true};
 await page.reload();await open(page);
 await page.evaluate(()=> (document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());
 await page.waitForSelector('#menu[open]');await page.click('#menuBody [data-view="settings"]');await sleep(200);
 if(await page.$('[data-settab="texts"]')) await page.click('[data-settab="texts"]');
 if(await page.$('[data-setsec="calls"]')) await page.click('[data-setsec="calls"]');
 await page.waitForSelector('#clOn');await sleep(300);assert.equal(await page.locator('#voiceMenu').count(),0);
 assert.equal(page.__errors.length,0,page.__errors.join('; '));
 console.log('PASS actual settings: save, state reload, unconfigured gate, no browser errors');
} finally {await browser.close();server.close()}
