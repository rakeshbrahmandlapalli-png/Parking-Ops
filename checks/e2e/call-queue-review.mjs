import assert from 'node:assert/strict';
import {fs,path,makeDb,phone,open,browser,server,sleep} from './harness.mjs';
const shot=process.env.CALL_QUEUE_SHOTS;if(shot)fs.mkdirSync(shot,{recursive:true});
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const fixture=theme=>{
 const db=makeDb();db.company.brand={theme,colour:'#F9A01B',ink:'#172838',short:'TakeOff',calls:true};db.company.calls={on:true};
 db.callsLog=[{id:91,company_id:'c1',at:ago(2),from_number:'+447700900123',booking_id:'b1',kind:'drops',reg:'EK14JPV',name:'SENIOR MISS',status:'missed',handled_name:'',handled_by:null},{id:92,company_id:'c1',at:ago(8),from_number:'+447700900124',booking_id:'b2',kind:'drops',reg:'CF75VLN',name:'KHAIRA MS',status:'missed',handled_name:'',handled_by:null},{id:93,company_id:'c1',at:ago(12),from_number:'',booking_id:null,reg:'',name:'',status:'missed',handled_name:'',handled_by:null},{id:94,company_id:'c1',at:ago(15),from_number:'+447700900126',booking_id:null,reg:'',name:'',status:'missed',handled_name:'COLLEAGUE',handled_by:'s2',callback_state:'claimed'}];return db;
};
let tests=0;const pass=s=>{tests++;console.log('PASS '+s)};
try {
 for(const width of [320,390,768,900,1024,1280,1366,1440]){
  const db=fixture('ops'),p=await phone(browser,db,{width});await open(p);await p.waitForSelector('#callQueueToggle');
  assert.equal(await p.locator('#callPop').count(),0);await p.click('#callQueueToggle');await p.waitForSelector('#callPop .cp-reg');await sleep(300);
  const fit=await p.locator('#callPop').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1});assert(fit,'call panel fits '+width);
  if(width>=900){const side=await p.evaluate(()=>({main:document.querySelector('#main').getBoundingClientRect().right,panel:document.querySelector('#callQueue').getBoundingClientRect().left}));assert(side.main<=side.panel,'desktop reserves board space: '+JSON.stringify(side));const off=await p.$$eval('#main .acts button',(bs,edge)=>{const m=document.querySelector('#main').getBoundingClientRect();return bs.filter(b=>{const r=b.getBoundingClientRect();return r.right>Math.min(edge,m.right)+1||r.left<m.left-1}).map(b=>b.textContent)},side.panel);assert.deepEqual(off,[],'every board button in view beside the dock without scrolling');}
  assert((await p.innerText('#callPop')).includes('4 outstanding'));assert(await p.locator('[data-callselect]').count()===3);
  if(shot && [390,1440].includes(width))await p.screenshot({path:path.join(shot,width===390?'02-mobile-call-sheet.png':'01-pc-call-queue.png')});
  await p.click('[data-calltake="91"]');await p.waitForSelector('[data-calloutcome="91"]');assert.equal(db.callsLog[0].callback_resolved_at,undefined);assert((await p.innerText('#callPop')).includes('Claimed by RAKESH'));
  await p.click('[data-calloutcome="91"][data-callresult="no_answer"]');await sleep(100);assert.equal(db.callsLog[0].callback_state,'no_answer');assert((await p.innerText('#callPop')).includes('4 outstanding'));
  await p.click('[data-calloutcome="91"][data-callresult="retry"]');await sleep(100);assert.equal(db.callsLog[0].callback_state,'retry');assert((await p.innerText('#callPop')).includes('Retry'));
  await p.click('[data-callclose]');assert.equal(await p.locator('#callPop').count(),0);assert((await p.innerText('#callQueueToggle')).includes('4'));await p.click('#callQueueToggle');
  await p.click('[data-calloutcome="91"][data-callresult="resolved"]');await sleep(150);assert(db.callsLog[0].callback_resolved_at);assert((await p.innerText('#callPop')).includes('Resolved by RAKESH'));assert((await p.innerText('#callPop')).includes('3 outstanding'));
  await p.click('[data-calltab="active"]');await p.click('[data-callselect="94"]');assert.equal(await p.locator('[data-calltake="94"]').count(),0);assert.equal(await p.locator('[data-calloutcome="94"][data-callresult="resolved"]').count(),0);
  await p.click('[data-calltab="active"]');await p.click('[data-callselect="93"]');assert((await p.innerText('#callPop')).includes('Number hidden'));assert.equal(await p.locator('#callPop a[href^="tel:"]').count(),0);
  await p.keyboard.press('Escape');assert.equal(await p.locator('#callPop').count(),0);
  await p.reload();await p.waitForSelector('#callQueueToggle');assert((await p.innerText('#callQueueToggle')).includes('3'));assert.equal(await p.locator('#callPop').count(),0);
  assert.deepEqual(p.__errors,[]);pass(width+'px: layout, claim, no answer, retry, minimise, resolve, ownership and reload');await p.context().close();
 }
 for(const theme of ['','pro','cards','premium','board','stdplus','ops-refined']){
  const db=fixture(theme),p=await phone(browser,db);await open(p);await p.waitForSelector('#callQueueToggle');await p.click('#callQueueToggle');await sleep(200);assert(await p.isVisible('[data-calltake="91"]'));assert.deepEqual(p.__errors,[]);pass((theme||'standard')+' theme: call controls render');await p.context().close();
 }
 // Wrong company events, more than 3 calls, XSS-safe text and failed writes.
 const db=fixture('ops'),p=await phone(browser,db);await open(p);await p.waitForSelector('#callQueueToggle');
 await p.evaluate(k=>dispatchEvent(new CustomEvent('takeoff:call',{detail:k})),{id:99,company_id:'other',status:'ringing',reg:'FOREIGN'});assert(!(await p.innerText('#callQueue')).includes('FOREIGN'));
 await p.route('**/rest/v1/rpc/call_claim',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Already claimed by colleague'})}));
 await p.click('#callQueueToggle');await p.click('[data-calltake="91"]');await sleep(150);assert.equal(db.callsLog[0].handled_by,null);assert(await p.isEnabled('[data-calltake="91"]'));pass('failed claim does not show success; wrong-tenant event ignored');
 await p.evaluate(()=>dispatchEvent(new CustomEvent('takeoff:call',{detail:{id:95,company_id:'c1',at:new Date().toISOString(),status:'ringing',name:'<img src=x onerror=alert(1)>',reg:'<script>bad()</script>'}})));assert.equal(await p.locator('#callPop script,#callPop img').count(),0);assert((await p.innerText('#callPop')).includes('<script>bad()</script>'));assert((await p.innerText('#callPop')).includes('5 outstanding'));pass('new incoming call opens; queue exceeds three without loss; caller text escaped');
 assert.deepEqual(p.__errors,[]);await p.context().close();
 // OVERSTAY car: the card says Overstay, never CALLED, and offers no AT DESK (as the board does).
 {const db=fixture('ops'),b=db.bookings.find(r=>r.id==='b1');b.called_at=ago(30);b.called_word='Overstay';const p=await phone(browser,db,{width:1440});await open(p);await p.click('#callQueueToggle');await p.waitForSelector('#callPop .cp-reg');const t=await p.innerText('#callPop .callpop');assert(t.includes('OVERSTAY ✓')&&/Vehicle status\s*Overstay/.test(t),t);assert(!t.includes('CALLED ✓'));assert.equal(await p.locator('#callPop [data-callwhat="desk"]').count(),0);assert.deepEqual(p.__errors,[]);pass('OVERSTAY car shows OVERSTAY, no CALLED tick, no AT DESK');await p.context().close();}
 // Phones: the minimised bar sits clear of the bottom bar and of + New booking, and the board makes room for it.
 for(const theme of ['','stdplus','ops']){const db=fixture(theme),p=await phone(browser,db);await open(p);await p.click('[data-kind="picks"]').catch(()=>{});await p.waitForSelector('#callQueueToggle');await sleep(200);
  const r=await p.evaluate(()=>{const q=document.querySelector('#callQueueToggle').getBoundingClientRect(),n=document.querySelector('#bnav'),d=document.querySelector('.deskbtn'),hit=(a,b)=>a&&b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
   const nv=n&&!n.classList.contains('hidden')?n.getBoundingClientRect():null,dv=d&&getComputedStyle(d).display!=='none'?d.getBoundingClientRect():null;return {bar:hit(q,nv),desk:hit(q,dv),room:parseFloat(getComputedStyle(document.querySelector('#main'),'::after').height)||0,off:q.bottom>innerHeight};});
  assert(!r.bar&&!r.desk&&!r.off&&r.room>=48,(theme||'standard')+' '+JSON.stringify(r));assert.deepEqual(p.__errors,[]);pass((theme||'standard')+' phone: minimised bar clear of the bottom bar and + New booking');await p.context().close();}
 console.log(tests+' browser scenarios passed');
} finally {await browser.close();server.close();}
