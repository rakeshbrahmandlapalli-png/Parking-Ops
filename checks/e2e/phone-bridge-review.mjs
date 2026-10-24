// Real web-app screenshots with sample data. No live backend or SMS calls.
// Run after installing the normal e2e dependencies:
//   HANDOFF_SHOTS=/absolute/output node checks/e2e/phone-bridge-review.mjs
import { fs, path, makeDb, phone, open, browser, server, sleep } from './harness.mjs';
const dir=process.env.HANDOFF_SHOTS;
if(!dir || !path.isAbsolute(dir)) throw Error('Set HANDOFF_SHOTS to an absolute output directory.');
fs.mkdirSync(dir,{recursive:true});
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const db=makeDb();
db.company.brand={ theme:'ops',colour:'#F9A01B',ink:'#172536',short:'TakeOff',texts:true,calls:true };
db.company.texts={on:true,sender:'TakeOff Parking',office:'07700 900123',meet:'Terminal meeting point',at:'18:00'};
db.company.calls={on:true};
db.company.pt_whatsapp='447700900123';
db.bookings.forEach((b,i)=>{b.phone='+447700900'+String(123+i).padStart(3,'0');});
Object.assign(db.bookings[0],{reg:'AB12CDE',name:'ALEX MORGAN',flight:'W95451'});
db.phoneHealth={paired:true,online:true,sms_ready:true,calls_ready:true,battery:86,queued:0,needs_review:1,expired:0,last_seen:ago(0)};
db.texts=[
 {id:11,at:ago(4),booking_id:'b1',rule:'sent',to_number:'+447700900123',body:'Hi Alex, your car AB12CDE is on its way to the terminal meeting point. Please wait there for our driver. TakeOff Parking',status:'delivered',error:'',staff_name:'OFFICE'},
];
db.sms=[{at:ago(1),booking_id:'b1',from_number:'+447700900123',body:'Thank you. We have our bags and are waiting at the meeting point.'}];
db.callsLog=[
 {id:1,company_id:'c1',at:ago(2),from_number:'+447700900124',booking_id:null,kind:'',reg:'',name:'',status:'missed',seconds:0,handled_name:''},
 {id:2,company_id:'c1',at:ago(8),from_number:'+447700900123',booking_id:'b1',kind:'drops',reg:'AB12CDE',name:'ALEX MORGAN',status:'answered',seconds:72,handled_name:'OFFICE'}
];
// A protocol-only Realtime fixture lets the actual app show its connected state.
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
let page;
const settings=async()=>{
 await page.evaluate(()=> (document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());
 await page.waitForSelector('#menu[open]'); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
 if(await page.$('[data-setsec="texts"]')) await page.click('[data-setsec="texts"]');
 if(await page.$('[data-settab="texts"]')) await page.click('[data-settab="texts"]');
 await page.waitForSelector('#phoneHealth'); await sleep(350);
 await page.locator('[data-sec="texts"]').evaluate(e=>{
 e.scrollIntoView({block:'start'});
 const shift=136-e.getBoundingClientRect().top;
 let p=e.parentElement;
 while(p && !(p.scrollHeight>p.clientHeight+2 && p.scrollTop>0)) p=p.parentElement;
 if(p) p.scrollTop-=shift; else window.scrollBy(0,-shift);
 }); await sleep(150);
};
try {
 page=await phone(browser,db,{width:420}); await page.setViewportSize({width:420,height:940}); await realtime(page); await open(page);
 await page.screenshot({path:path.join(dir,'00-board.png')});
 await page.setViewportSize({width:420,height:740}); await page.screenshot({path:path.join(dir,'00-board-for-native.png')}); await page.setViewportSize({width:420,height:940});
 await page.evaluate(k=>window.dispatchEvent(new CustomEvent('takeoff:call',{detail:k})),{id:91,company_id:'c1',at:ago(0),from_number:'+447700900123',booking_id:'b1',kind:'drops',reg:'AB12CDE',name:'ALEX MORGAN',status:'ringing',handled_name:''});
 await sleep(200); await page.screenshot({path:path.join(dir,'03-incoming-call.png')}); await page.click('[data-callclose="91"]');
 await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector('#panel[open]'); await sleep(500);
 await page.locator('#carTexts').scrollIntoViewIfNeeded(); await sleep(150); await page.screenshot({path:path.join(dir,'02-customer-messages.png')});
 await page.keyboard.press('Escape'); await sleep(200); await settings(); await page.screenshot({path:path.join(dir,'01-phone-status.png')});
 Object.assign(db.phoneHealth,{online:false,battery:24,queued:3,needs_review:1,last_seen:ago(20)});
 await page.click('[data-phone-health]'); await sleep(250); await page.screenshot({path:path.join(dir,'04-offline-status.png')});
 await page.context().close();
 page=await phone(browser,db,{width:420}); await page.setViewportSize({width:420,height:940}); await realtime(page); await open(page);
 await page.evaluate(()=> (document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());
 await page.waitForSelector('#menu[open]'); await page.click('#menuBody [data-view="calls"]'); await sleep(500);
 await page.screenshot({path:path.join(dir,'05-call-log.png')});
 if(page.__errors.length) throw Error(page.__errors.join('; '));
 console.log('Saved real app previews with sample data to '+dir);
} finally { await browser.close(); server.close(); }
