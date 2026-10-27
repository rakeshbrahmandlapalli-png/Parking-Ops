// Real app + mock APIs only. Run: node checks/e2e/notification-centre-review.mjs
import assert from 'node:assert/strict';
import {makeDb,phone,open,browser,server,sleep,fs,path} from './harness.mjs';
let passed=0; const check=(name,ok)=>{assert.ok(ok,name);passed++;console.log('PASS '+name);};
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const hm=m=>new Date(Date.now()-m*60000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});
const dir=process.env.NOTIFICATION_SHOTS;
if(dir)fs.mkdirSync(dir,{recursive:true});
function items(){return [
 {id:'n1',event_key:'collection:1',kind:'drops',title:'AT DESK: #84 · AB12 CDE (NB) — PATEL',body:'AT DESK at '+hm(8)+' by SUGU · EZY8012 · due 06:40',booking_id:'b1',reg:'AB12 CDE',yard:'NB',key_tag:84,created_at:ago(8),urgency:'urgent',can_accept:true,claimed_by:null,resolved:false,read_at:null,activity:[]},
 {id:'n2',event_key:'key:2',kind:'keys',title:'Key marked missing: JK19 RST',body:'Physical key check marked this key missing. Open the booking and confirm the key before collection.',booking_id:'b2',created_at:ago(5),urgency:'urgent',can_accept:true,claimed_by:null,resolved:false,read_at:null,activity:[]},
 {id:'n3',kind:'lanes',title:'Return vehicle blocked: LM23 XYZ',body:'Lane 2 · position 4. Cars are recorded ahead of the exit. Open the yard planner to arrange confirmed moves.',booking_id:'b2',created_at:ago(6),urgency:'urgent',can_accept:true,claimed_by:'s2',claimed_name:'SUGU',resolved:false,read_at:ago(1),activity:[]},
 {id:'n4',kind:'flights',title:'✈️ FLIGHT CANCELLED: #12 · KX70 PLM — JONES',body:'FR2417 has been cancelled by the airline. The customer may not be coming back as booked.',booking_id:'b2',created_at:ago(20),urgency:'routine',can_accept:true,claimed_by:'s1',claimed_name:'RAKESH',resolved:false,read_at:ago(1),activity:[]},
 {id:'n5',kind:'drops',title:'CALLED: #31 · YT21 HHA (S) — BROWN',body:'CALLED at '+hm(40)+' by RAKESH · BA2741 · due 06:05',booking_id:'b3',created_at:ago(40),urgency:'routine',can_accept:false,resolved:true,read_at:ago(2),activity:[]}
];}
async function setup(theme,width=390,pushReady=false){
 const db=makeDb();db.company.brand={theme,short:'TAKEOFF',colour:'#f7a01c',lane_planner:true};
 db.bookings.forEach(b=>b.company_id='c1');
 const page=await phone(browser,db,{width});await page.setViewportSize({width,height:900});
 await page.context().routeWebSocket('**/realtime/v1/websocket*', socket=>socket.onMessage(raw=>{
  try{const m=JSON.parse(String(raw)),a=Array.isArray(m);const [join,ref,topic,event,payload]=a?m:[m.join_ref,m.ref,m.topic,m.event,m.payload];if(event!=='phx_join'&&event!=='heartbeat')return;const response=event==='phx_join'?{postgres_changes:(payload.config?.postgres_changes||[]).map((x,i)=>({...x,id:i+1}))}:{};const body={status:'ok',response};socket.send(JSON.stringify(a?[join,ref,topic,'phx_reply',body]:{join_ref:join,ref,topic,event:'phx_reply',payload:body}));}catch{}
 }));
 if(pushReady){
  await page.context().addInitScript(()=>{
   Object.defineProperty(window,'Notification',{value:{permission:'granted',requestPermission:async()=> 'granted'}});
   if(!window.PushManager)window.PushManager=function(){};
   const sub={endpoint:'https://push.test/this-device',toJSON:()=>({endpoint:'https://push.test/this-device',keys:{p256dh:'sample-public',auth:'sample-auth'}}),unsubscribe:async()=>true};
   Object.defineProperty(navigator.serviceWorker,'getRegistration',{value:async()=>({pushManager:{getSubscription:async()=>sub}})});
  });
  await page.context().route('**/rest/v1/push_subscriptions*',r=>r.fulfill({json:{endpoint:'https://push.test/this-device'}}));
  await page.context().route('**/rest/v1/rpc/ops_push_device_status',r=>r.fulfill({json:{registered:true,queued:1,failed_24h:0,last_accepted:ago(5)}}));
 }
 const state={items:items(),options:{routine_silent:false,paused_until:null}},calls=[];
 let error='',gate;
 await page.context().route('**/rest/v1/rpc/ops_notification_feed',async r=>{if(gate)await gate;if(error)return r.fulfill({status:400,json:{code:error,message:'Database update needed'}});return r.fulfill({json:state});});
 await page.context().route('**/rest/v1/rpc/ops_notification_action',r=>{const a=r.request().postDataJSON();calls.push(a);const n=state.items.find(n=>n.id===a.p_id);if(a.p_action==='read')n.read_at=ago(0);if(a.p_action==='accept'){n.claimed_by='s1';n.claimed_name='RAKESH';n.activity.push({at:ago(0),action:'accept',staff_name:'RAKESH'});}if(a.p_action==='release')n.claimed_by=null;if(a.p_action==='assign'){n.claimed_by=a.p_staff;n.claimed_name='SUGU';}return r.fulfill({json:null});});
 await page.context().route('**/rest/v1/rpc/ops_notification_clear',r=>{const a=r.request().postDataJSON();calls.push(a);let n=0;state.items.forEach(x=>{if(a.p_ids.includes(x.id)&&!x.cleared_at){x.cleared_at=ago(0);n++;}});return r.fulfill({json:n});});
 await page.context().route('**/rest/v1/rpc/set_ops_notification_options',r=>{calls.push(r.request().postDataJSON());state.options.routine_silent=r.request().postDataJSON().p_routine_silent;return r.fulfill({json:null});});
 await open(page);await page.waitForFunction(()=>document.querySelector('#notifyBadge')?.textContent==='2');
 return {page,state,calls,db,setError:x=>error=x,setGate:x=>gate=x};
}
const menuSel=async page=>await page.isVisible('#bnav [data-bn=menuBtn]')?'#bnav [data-bn=menuBtn]':'#menuBtn';
async function centre(page){if(await page.isVisible('#notifyBtn'))return page.click('#notifyBtn');await page.click(await menuSel(page));await page.click('#menuBody [data-view=notifications]');}
try{
 for(const theme of ['','pro','cards','premium','board','stdplus','ops','ops-refined']){
  const {page}=await setup(theme);
  check(`${theme||'standard'}: board and notification bell fit 390px`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check(`${theme||'standard'}: phone top bar shows the bell with the count, nothing sideways`,await page.isVisible('#notifyBtn')&&(await page.textContent('#notifyBadge'))==='2'&&await page.evaluate(()=>document.querySelector('.bar').scrollWidth<=document.querySelector('.bar').clientWidth+1));
  await centre(page);await page.waitForSelector('.nc-row');
  check(`${theme||'standard'}: active alerts visible`,await page.locator('.nc-row').count()===4);
  check(`${theme||'standard'}: centre fits phone`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.click('[data-nctab=urgent]');check(`${theme||'standard'}: urgent filter`,await page.locator('.nc-row').count()===3);
  await page.click('[data-nctab=mine]');check(`${theme||'standard'}: mine filter`,await page.locator('.nc-row').count()===1);
  check(`${theme||'standard'}: Mine has no Clear all (my accepted task stays)`,!await page.isVisible('[data-ncclear]'));
  await page.click('[data-nctab=history]');check(`${theme||'standard'}: resolved history`,await page.locator('.nc-row').count()===1);
  check(`${theme||'standard'}: Resolved has no Clear all`,!await page.isVisible('[data-ncclear]'));
  await page.click('[data-nctab=all]');check(`${theme||'standard'}: All offers Clear all 3 (not my accepted task)`,(await page.innerText('[data-ncclear]')).trim()==='Clear all 3');
  await page.click('[data-ncclear]');check(`${theme||'standard'}: Clear all asks first and fits`,await page.isVisible('[data-ncclearok]')&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check(`${theme||'standard'}: no browser errors`,page.__errors.length===0);
  await page.context().close();
 }
 // Clear all (part 129): confirm, only this tab's rows, my accepted task kept, cancel does nothing.
 let t=await setup('ops');let {page,state,calls}=t;
 await centre(page);await page.waitForSelector('.nc-row');
 await page.click('[data-nctab=urgent]');await page.click('[data-ncclear]');
 check('confirm names the count and says it is only your list',/Clear 3 notifications from your list\?/.test(await page.innerText('.nc-confirm'))&&/Only your list/.test(await page.innerText('.nc-confirm')));
 await page.click('[data-ncclearno]');check('Cancel clears nothing',!await page.isVisible('.nc-confirm')&&!calls.some(x=>x.p_ids));
 await page.click('[data-ncclear]');await page.click('[data-nctab=all]');check('switching tab drops the confirm',!await page.isVisible('.nc-confirm'));
 await page.click('[data-nctab=urgent]');await page.click('[data-ncclear]');await page.click('[data-ncclearok]');
 await page.waitForFunction(()=>!document.querySelector('[data-ncclear]')&&document.querySelectorAll('.nc-row').length===0);
 const sentIds=calls.find(x=>x.p_ids).p_ids;
 check('Urgent tab clears only its own rows (not the routine task I accepted)',sentIds.length===3&&['n1','n2','n3'].every(x=>sentIds.includes(x))&&!sentIds.includes('n4'));
 await page.click('[data-nctab=all]');check('my accepted task is still on All, with no Clear all',await page.locator('.nc-row').count()===1&&!await page.isVisible('[data-ncclear]'));
 check('badge counts only what is left',(await page.innerText('#notifyBadge'))==='');
 await page.click('[data-nctab=history]');check('cleared alerts move to Resolved, marked Cleared',await page.locator('.nc-row').count()===4&&(await page.locator('.nc-row .nc-meta span',{hasText:'Cleared'}).count())===3);
 await page.click('[data-ncopen=n1]');check('detail says it was cleared from your list',/Cleared from your list/.test(await page.innerText('.nc-detail')));
 check('no browser errors while clearing',page.__errors.length===0);
 await page.context().close();
 t=await setup('ops');({page,state,calls}=t);
 await centre(page);await page.click('[data-ncopen=n1]');await page.waitForFunction(()=>document.querySelector('#notifyBadge').textContent==='1');
 check('opening detail marks only that alert read',calls.some(x=>x.p_action==='read'&&x.p_id==='n1'));
 await page.click('[data-ncaccept=n1]');await page.waitForSelector('[data-ncrelease=n1]');
 check('accepted task shows handling person',/Accepted by RAKESH/.test(await page.innerText('.nc-detail')));
 check('acceptance never sends booking RPC',!t.db.calls.some(c=>c.fn==='tap_drop'));
 if(dir){await page.waitForSelector('.toast',{state:'detached'});await page.screenshot({path:path.join(dir,'02-task-details.png'),fullPage:false});}
 await page.selectOption('#ncAssignee','s2');await page.click('[data-ncassign=n1]');await page.waitForFunction(()=>document.querySelector('.nc-status')?.textContent.includes('SUGU'));
 check('assignment uses explicit selected staff',calls.some(x=>x.p_action==='assign'&&x.p_staff==='s2'));
 await page.click('[data-ncback]');if(dir)await page.waitForSelector('.toast',{state:'detached'});if(dir)await page.screenshot({path:path.join(dir,'01-notification-centre.png'),fullPage:false});
 await page.click('[data-ncsettings]');await page.check('#ncSilent');await page.selectOption('#ncPause','8');
 // Refresh while editing must keep the draft, including asynchronous Me prefs.
 await page.click('[data-ncrefresh]');await sleep(100);
 check('preference draft survives refresh',await page.isChecked('#ncSilent')&&await page.inputValue('#ncPause')==='8');
 if(dir)await page.screenshot({path:path.join(dir,'03-preferences.png'),fullPage:false});
 await page.click('[data-ncsave]');await sleep(150);
 check('preferences sent with expected values',calls.some(x=>x.p_pause_hours===8&&x.p_routine_silent===true));
 await page.click('[data-ncback]');await page.context().setOffline(true);await page.click('[data-ncopen=n2]');
 check('offline task acceptance disabled',await page.isDisabled('[data-ncaccept=n2]'));
 await page.context().setOffline(false);await page.context().close();
 t=await setup('ops',320);page=t.page;await centre(page);
 check('small 320px centre fits',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.context().close();
 t=await setup('ops',1280);page=t.page;await centre(page);
 check('desktop centre fits',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(dir)await page.screenshot({path:path.join(dir,'04-desktop.png'),fullPage:false});await page.context().close();
 t=await setup('ops');page=t.page;t.setError('PGRST202');await centre(page);await page.click('[data-ncrefresh]');await sleep(100);
 check('missing migration is explained without breaking app',/database update/.test(await page.innerText('#main')));await page.context().close();
 t=await setup('ops');page=t.page;
 await page.goto(page.url()+'?notice=collection%3A1');await page.waitForSelector('.nc-detail');
 check('push link opens the exact alert',/AB12 CDE/.test(await page.innerText('.nc-detail')));
 check('consumed deep link removed',!new URL(page.url()).searchParams.has('notice'));
 await page.click('[data-ncbooking=n1]');await page.waitForSelector('#panel[open]');
 check('exact booking opens from notification',/EK14JPV/.test(await page.innerText('#panel')));
 await page.context().close();
 t=await setup('ops');page=t.page;t.state.items[0].title='<img src=x onerror=alert(1)>';
 await centre(page);await page.click('[data-ncrefresh]');await sleep(100);
 check('untrusted notification text escaped',await page.locator('.nc-title img').count()===0&&page.__dialogs.length===0);
 check('no browser errors in interaction flow',page.__errors.length===0);
 await page.context().close();
 t=await setup('ops',390,true);page=t.page;let testRequest;
 await page.context().route('**/functions/v1/send-alerts',r=>{testRequest=r.request().postDataJSON();return r.fulfill({json:{sent:1}});});
 await centre(page);await page.click('[data-ncsettings]');await page.waitForSelector('[data-notifytest]');
 check('registered device shows a test action',await page.isVisible('[data-notifytest]'));
 check('device queue and acceptance health are visible',/1 queued/.test(await page.innerText('#main'))&&/Last accepted by push service/.test(await page.innerText('#main')));
 if(dir)await page.screenshot({path:path.join(dir,'05-push-device-status.png'),fullPage:false});
 await page.click('[data-notifytest]');await sleep(100);
 check('test action targets the current endpoint',testRequest?.endpoint==='https://push.test/this-device');
 check('test result does not promise lock-screen delivery',/delivery is not confirmed/.test(await page.innerText('body')));
 await page.context().close();
 t=await setup('ops');page=t.page;let release;
 const pending=new Promise(r=>release=r);t.setGate(pending);
 await centre(page);await page.click('#menuBtn');await page.click('#menuBody [data-view=me]');await page.click('[data-signout]');await page.waitForSelector('#pinGate:not(.hidden)');
 release();await sleep(150);
 check('late notification response cannot reopen a signed-out session',await page.isVisible('#pinGate')&&!await page.isVisible('#app'));
 check('sign-out clears notification state and badge',await page.locator('.nc-row').count()===0&&(await page.innerText('#notifyBadge'))==='');
 await page.context().close();
 if(dir){
  // Previews for review: TakeOff's look on a phone, Operations on a computer, Premium (Airport Parking Bay) on a phone.
  const shot=async(page,name)=>{await page.waitForSelector('.toast',{state:'detached'}).catch(()=>{});await page.screenshot({path:path.join(dir,name+'.png')});};
  t=await setup('stdplus',390,true);page=t.page;
  await shot(page,'takeoff-phone-1-board');
  await page.click(await menuSel(page));await page.waitForSelector('#menuBody [data-view=notifications]');await shot(page,'takeoff-phone-2-menu');
  await page.click('#menuBody [data-view=notifications]');await page.waitForSelector('.nc-row');await shot(page,'takeoff-phone-3-list');
  await page.click('[data-ncopen=n1]');await page.waitForSelector('.nc-detail');await shot(page,'takeoff-phone-4-task');
  await page.click('[data-ncaccept=n1]');await page.waitForSelector('[data-ncrelease=n1]');await page.evaluate(()=>scrollTo(0,0));await shot(page,'takeoff-phone-5-accepted');
  await page.click('[data-ncback]');await page.click('[data-ncsettings]');await page.waitForSelector('[data-notifytest]');await shot(page,'takeoff-phone-6-preferences');
  await page.context().close();
  t=await setup('ops',1440);page=t.page;await shot(page,'ops-desktop-1-board');
  await page.click('#notifyBtn');await page.waitForSelector('.nc-row');await shot(page,'ops-desktop-2-list');
  await page.click('[data-ncopen=n2]');await page.waitForSelector('.nc-detail');await shot(page,'ops-desktop-3-task');
  await page.context().close();
  t=await setup('premium',390);page=t.page;await shot(page,'premium-phone-1-board');
  await centre(page);await page.waitForSelector('.nc-row');await shot(page,'premium-phone-2-list');
  await page.context().close();
 }
 console.log(`${passed} browser checks passed`);
}finally{await browser.close();server.close();}
