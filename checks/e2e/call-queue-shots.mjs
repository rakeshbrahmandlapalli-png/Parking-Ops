// Preview screenshots of the call queue: CALL_QUEUE_SHOTS=<dir> node call-queue-shots.mjs
import {fs,path,makeDb,phone,open,browser,server,sleep} from './harness.mjs';
const dir=process.env.CALL_QUEUE_SHOTS||'/tmp/call-queue-shots';fs.mkdirSync(dir,{recursive:true});
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const fixture=theme=>{
 const db=makeDb();db.company.brand={theme,colour:'#F9A01B',ink:'#172838',short:'TakeOff',calls:true};db.company.calls={on:true};
 db.callsLog=[{id:91,company_id:'c1',at:ago(2),from_number:'+447700900123',booking_id:'b1',kind:'drops',reg:'EK14JPV',name:'SENIOR MISS',status:'missed',handled_name:'',handled_by:null},{id:92,company_id:'c1',at:ago(8),from_number:'+447700900124',booking_id:'b2',kind:'drops',reg:'CF75VLN',name:'KHAIRA MS',status:'missed',handled_name:'',handled_by:null},{id:93,company_id:'c1',at:ago(12),from_number:'',booking_id:null,reg:'',name:'',status:'missed',handled_name:'',handled_by:null},{id:94,company_id:'c1',at:ago(15),from_number:'+447700900126',booking_id:null,reg:'',name:'',status:'missed',handled_name:'COLLEAGUE',handled_by:'s2',callback_state:'claimed'}];
 return db;
};
const only=(process.env.ONLY||'').split(',').filter(Boolean);
const want=n=>!only.length||only.some(o=>n.includes(o));
const shots=[['ops',1440,'open'],['ops',1366,'open'],['ops',1280,'open'],['ops',1024,'open'],['ops',1440,'min'],['ops',1440,'open','picks'],['ops-refined',1440,'open'],['stdplus',1440,'open'],['stdplus',390,'min'],['stdplus',390,'open'],['ops',390,'min'],['premium',390,'open'],['ops',390,'claimed'],['ops',1440,'overstay'],['ops',1024,'overstay'],['ops',900,'open'],['ops-refined',1024,'open','picks']];
try{
 for(const [theme,width,state,kind] of shots){
  const name=`${theme}-${width}-${state}${kind?'-'+kind:''}`;if(!want(name))continue;
  const db=fixture(theme);
  if(state==='overstay'){const b=db.bookings.find(r=>r.id==='b1');if(b){b.called_at=ago(30);b.called_word='Overstay';}}
  const p=await phone(browser,db,{width});await p.setViewportSize({width,height:width<900?844:900});await open(p);
  if(kind==='picks')await p.click('[data-kind="picks"]').catch(()=>{});
  await p.waitForSelector('#callQueueToggle');
  if(state!=='min'){await p.click('#callQueueToggle');await p.waitForSelector('#callPop .cp-reg');}
  if(state==='claimed'){await p.click('[data-calltake="91"]');await p.waitForSelector('[data-calloutcome="91"]');await p.$eval('#callPop .cp-scroll',e=>e.scrollTop=400);}
  if(state==='min')await p.evaluate(()=>scrollTo(0,99999));
  await sleep(300);await p.screenshot({path:path.join(dir,name+'.png')});
  console.log('shot',name,JSON.stringify(p.__errors));await p.context().close();
 }
}finally{await browser.close();server.close();}
