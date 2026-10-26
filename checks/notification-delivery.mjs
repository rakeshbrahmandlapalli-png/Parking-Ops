// Real Edge Function with fake Postgres and push provider. No network.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'notification-delivery-'));
const source=fs.readFileSync(new URL('../supabase/functions/send-alerts/index.ts',import.meta.url),'utf8').replace(/^import \{ createClient \} from .*$/m,'const createClient=(globalThis as any).__createClient;').replace(/^import webpush from .*$/m,'const webpush=(globalThis as any).__webpush;');
fs.writeFileSync(path.join(dir,'index.ts'),source);
const bid='00000000-0000-4000-8000-000000000001',now=new Date().toISOString();
let db,records,options,pushes,legacy,handler,queueMode,jobs,results,failPush;let passed=0;
const test=(name,ok)=>{assert.ok(ok,name);passed++;console.log('PASS '+name);};
function reset(){records=[];options=[];pushes=[];legacy=false;queueMode=false;jobs=[];results=[];failPush=false;db={
 bookings:[{id:bid,kind:'drops',company_id:'c1',num:84,reg:'AB12 CDE',name:'Sample',called_at:now,called_by:'s1',sheets:{day:'2026-10-26'}}],
 staff:[{id:'s1',company_id:'c1',name:'One',active:true},{id:'s2',company_id:'c1',name:'Two',active:true}],
 alert_prefs:[],alert_log:[],push_subscriptions:[{id:'p1',staff_id:'s1',company_id:'c1',endpoint:'https://push.test/one',p256dh:'x',auth:'y'},{id:'p2',staff_id:'s2',company_id:'c1',endpoint:'https://push.test/two',p256dh:'x',auth:'y'}]
};}
function from(table){const f=[];const rows=()=>db[table].filter(r=>f.every(t=>t(r)));const q={select(){return q;},eq(c,v){f.push(r=>r[c]===v);return q;},in(c,v){f.push(r=>v.includes(r[c]));return q;},maybeSingle:async()=>({data:rows()[0]||null}),insert:async(v)=>{if(db[table].some(x=>x.key===v.key))return{error:{code:'23505'}};db[table].push(v);return{error:null};},delete(){return{eq:async()=>({})}},then:(a,b)=>Promise.resolve({data:rows()}).then(a,b)};return q;}
globalThis.__createClient=()=>({from,rpc:async(name,args)=>{
 if(name==='me')return{data:{id:'s1',name:'One',company_id:'c1'}};
 if(name==='record_ops_notification'){records.push(args);return legacy?{error:{code:'PGRST202'}}:{data:null};}
 if(name==='ops_notification_delivery')return{data:options};
 if(name==='ops_push_enqueue'&&queueMode){jobs=db.push_subscriptions.filter(s=>args.p_staff.includes(s.staff_id)&&(!args.p_endpoint||s.endpoint===args.p_endpoint)).map(s=>({...s,id:'job-'+s.id,lease:'lease',payload:args.p_payload,ttl:args.p_ttl,urgency:args.p_urgency}));return{data:true};}
 if(name==='ops_push_claim'&&queueMode){const claimed=jobs;jobs=[];return{data:claimed};}
 if(name==='ops_push_result'){results.push(args);return{data:null};}
 if(name==='alert_discord')return{data:null};
 return{data:null};
}});
globalThis.__webpush={setVapidDetails(){},sendNotification:async(sub,payload,options)=>{if(failPush)throw{statusCode:503};pushes.push({endpoint:sub.endpoint,note:JSON.parse(payload),options});}};
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_ANON_KEY:'anon',VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private'})[k]},serve:h=>handler=h};
await import(pathToFileURL(path.join(dir,'index.ts')).href);
async function post(body){const r=await handler(new Request('http://test',{method:'POST',body:JSON.stringify(body)}));assert.equal(r.status,200);return r.json();}
reset();await post({type:'booking',id:bid});test('event persisted even without sending to its creator',records[0].p_staff.join()==='s1,s2'&&pushes.length===1&&pushes[0].endpoint.endsWith('/two'));
test('urgent pushes expire promptly and coalesce by booking',pushes[0].options.TTL===600&&pushes[0].options.topic.length===32);
test('push links to its stable inbox key',pushes[0].note.url.includes('?notice=collection%3A')&&pushes[0].options.urgency==='high');
await post({type:'booking',id:bid});test('duplicate trigger does not push again',pushes.length===1&&records.length===1);
reset();db.push_subscriptions=[];await post({type:'booking',id:bid});test('inbox works without a registered phone',records.length===1&&pushes.length===0);
reset();options=[{staff_id:'s2',paused:true}];await post({type:'booking',id:bid});test('pause affects push while retaining inbox',records.length===1&&pushes.length===0);
reset();options=[{staff_id:'s2',routine_silent:true}];await post({type:'booking',id:bid});test('routine silence does not silence urgent tasks',pushes[0].note.silent===false);
reset();legacy=true;await post({type:'booking',id:bid});test('existing push continues if optional schema is absent',pushes.length===1&&pushes[0].note.url.includes('?booking='));
reset();db.alert_prefs=[{staff_id:'s1',drops:false}];const r=await post({type:'test',endpoint:'https://push.test/one'});test('test bypasses disabled DROPS preference and targets this device',r.sent===1&&pushes.length===1&&pushes[0].endpoint.endsWith('/one'));
test('test does not create inbox history',records.length===0);
reset();await post({type:'test',endpoint:'https://push.test/not-owned'});test('test cannot target an unowned endpoint',pushes.length===0);
reset();queueMode=true;await post({type:'booking',id:bid});test('durable path sends a leased job once',pushes.length===1&&results.length===1&&results[0].p_success===true);
reset();queueMode=true;failPush=true;await post({type:'booking',id:bid});test('provider error is finalised for bounded retry',pushes.length===0&&results[0].p_success===false&&results[0].p_code===503);
reset();db.bookings[0].called_word='Overstay';await post({type:'booking',id:bid});test('OVERSTAY is a routine entry of its own, never an urgent collection task',records[0].p_key==='overstay:'+bid&&records[0].p_urgency==='routine'&&pushes[0].options.urgency==='normal');
fs.rmSync(dir,{recursive:true,force:true});console.log(`${passed} delivery checks passed`);
