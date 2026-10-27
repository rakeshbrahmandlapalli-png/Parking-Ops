// Preview screenshots of Clear all (part 129): NOTIFICATION_CLEAR_SHOTS=<dir> node notification-clear-shots.mjs
import {fs,path,makeDb,phone,open,browser,server,sleep} from './harness.mjs';
const dir=process.env.NOTIFICATION_CLEAR_SHOTS||'/tmp/notification-clear-shots';fs.mkdirSync(dir,{recursive:true});
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const regs=[['SS51MBS','MUPASI MR'],['KR25EWA','BROWN MRS'],['','']];
// A list like the one on the phone on 27 Oct: incoming-call alerts, and one complaint.
const items=()=>Array.from({length:12},(_,i)=>{const [reg,name]=regs[i%3];return {id:'c'+i,event_key:'call:'+i,kind:'calls',title:reg?'📞 Incoming call: '+reg+' — '+name:"📞 Incoming call: not on today's cars",body:(reg?'PICKS · return 1 Nov, 10:30 · key 23 · ':'')+'07••• •••9'+(10+i),booking_id:null,created_at:ago(5+i*3),urgency:'urgent',can_accept:false,claimed_by:null,resolved:false,read_at:null,activity:[]};})
 .concat([{id:'k1',event_key:'complaint:1',kind:'complaint',title:'COMPLAINT: #12 · KX70 PLM — JONES',body:'Scratch on the rear bumper',booking_id:'b2',created_at:ago(60),urgency:'urgent',can_accept:false,claimed_by:null,resolved:false,read_at:null,activity:[]}]);
const shots=[['stdplus',390],['ops',1440],['premium',390]];
try{
 for(const [theme,width] of shots){
  const db=makeDb();db.company.brand={theme,colour:'#F9A01B',short:'TakeOff',calls:true};
  const p=await phone(browser,db,{width});await p.setViewportSize({width,height:width<900?844:900});
  const state={items:items(),options:{routine_silent:false,paused_until:null}};
  await p.context().route('**/rest/v1/rpc/ops_notification_feed',r=>r.fulfill({json:state}));
  await p.context().route('**/rest/v1/rpc/ops_notification_clear',r=>{const a=r.request().postDataJSON();let n=0;state.items.forEach(x=>{if(a.p_ids.includes(x.id)){x.cleared_at=ago(0);n++;}});return r.fulfill({json:n});});
  await open(p);
  if(await p.isVisible('#notifyBtn'))await p.click('#notifyBtn');else{await p.click(await p.isVisible('#bnav [data-bn=menuBtn]')?'#bnav [data-bn=menuBtn]':'#menuBtn');await p.click('#menuBody [data-view=notifications]');}
  await p.waitForSelector('[data-ncclear]');
  const shot=async n=>{await sleep(300);await p.screenshot({path:path.join(dir,`${theme}-${width}-${n}.png`)});};
  await shot('1-list');
  await p.click('[data-ncclear]');await p.waitForSelector('.nc-confirm');await shot('2-confirm');
  await p.click('[data-ncclearok]');await p.waitForSelector('.nc-empty');await p.waitForSelector('.toast',{state:'detached'}).catch(()=>{});await shot('3-cleared');
  await p.click('[data-nctab=history]');await shot('4-resolved');
  console.log('shot',theme,width,JSON.stringify(p.__errors));await p.context().close();
 }
}finally{await browser.close();server.close();}
