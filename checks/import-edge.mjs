// Execute the actual TypeScript edge orchestration with fake RPCs and a
// pre-collected plan. No supplier login, network or live database is used.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), source=fs.readFileSync(new URL('supabase/functions/takeoff-bookings/index.ts',root),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'import-edge-'));
let calls=[],permission=true,applyError=null;
const co={id:'c1',slug:'takeoff',drops_day_end:'06:00'}, clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
globalThis.__createClient=()=>({from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:co})}),rpc:async(fn,args)=>{calls.push({fn,args});let data=null;
if(fn==='me')data={id:'staff',user_id:'u1',company_id:'c1'};
if(fn==='can')data=permission;
if(fn==='auto_import_row')data={config:{base:'https://example.test/admin/',manual_enabled:true,schedule_times:[clock],scheduled_by:'u1'}};
if(fn==='swift_lock')data='lock';if(fn==='swift_reviews_known')data=[];
if(fn==='swift_apply_checked')return applyError?{error:{message:applyError}}:{data:[{kind:'drops',day:'2026-10-24',added:args.p_batches.reduce((n,b)=>n+b.rows.length,0),updated:0}]};return {data,error:null};}});
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://example.test':k},serve(){}};
globalThis.fetch=async()=>{throw new Error('Test attempted network access');};
const rewritten=source.replace(/^import \{ createClient \}.*$/m,'const createClient=(globalThis as any).__createClient;').replace(/^import \* as XLSX.*$/m,'const XLSX={};').replace('from "./reader.mjs"','from '+JSON.stringify(new URL('supabase/functions/takeoff-bookings/reader.mjs',root).href)).replace('from "./swift.mjs"','from '+JSON.stringify(new URL('supabase/functions/takeoff-bookings/swift.mjs',root).href))+ '\nexport {handle,scheduledFor};export function setCollect(fn:any){collect=fn;}';
fs.writeFileSync(path.join(temp,'index.ts'),rewritten);const edge=await import(pathToFileURL(path.join(temp,'index.ts')));
const fixture={hash:'hash1',refs:['A','B'],existing:[],p:{counts:{new:2,changed:0,review:0,invalid:0},items:[{kind:'drops',ref:'A',status:'new'},{kind:'drops',ref:'B',status:'new'}],batches:[{kind:'drops',day:'2026-10-24',rows:[{ref:'A'},{ref:'B'}]}],reviews:[],invalid:[]},report:{}};
edge.setCollect(async()=>fixture);let passed=0;function check(n,c){assert.ok(c,n);console.log('PASS '+n);passed++;}
const req=body=>new Request('https://example.test/functions/v1/takeoff-bookings',{method:'POST',headers:{authorization:'Bearer example','content-type':'application/json'},body:JSON.stringify(body)});
let result=await (await edge.handle(req({action:'apply',expect_hash:'hash1',selected:['drops|B']}))).json();check('edge applies exactly the selected booking',result.ok===true&&calls.find(c=>c.fn==='swift_apply_checked').args.p_batches[0].rows[0].ref==='B'&&result.summary.selected===1);
check('edge passes the database snapshot into the atomic writer',calls.find(c=>c.fn==='swift_apply_checked').args.p_refs.join()==='A,B');
calls=[];result=await (await edge.handle(req({action:'apply',expect_hash:'old',selected:['drops|B']}))).json();check('edge refuses changed preview hash before writing',result.ok===false&&!calls.some(c=>c.fn==='swift_apply_checked'));
calls=[];result=await (await edge.handle(req({action:'apply',expect_hash:'hash1',selected:['drops|INJECTED']}))).json();check('edge rejects unrecognised selection',result.ok===false&&!calls.some(c=>c.fn==='swift_apply_checked'));
calls=[];permission=false;const denied=await edge.handle(req({action:'apply',expect_hash:'hash1'}));check('edge refuses users without import access',denied.status===403&&!calls.some(c=>c.fn==='swift_apply_checked'));permission=true;
calls=[];result=await edge.scheduledFor(co);check('scheduled import still runs through checked writer',!!result.imported&&calls.some(c=>c.fn==='swift_apply_checked'));
check('scheduled result records the correct selected count',calls.find(c=>c.fn==='auto_import_record').args.p_summary.selected===2);
calls=[];applyError='Bookings changed since the preview';result=await edge.scheduledFor(co);check('failed scheduled import records failure and releases its lock',result.failed===applyError||/changed since/.test(result.failed));check('scheduled lock is always released',calls.some(c=>c.fn==='swift_unlock'));
fs.rmSync(temp,{recursive:true});console.log(`${passed} edge orchestration checks passed`);
