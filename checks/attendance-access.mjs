import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../supabase/functions/aero-access/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/,'');
let handler, mint=0, scenario={}, suppliedBearer;
const createClient=(url,key,opts)=>{
 if(key==='service')return {auth:{admin:{generateLink:async()=>{mint++;return scenario.mintError?{error:{message:'Internal secret detail'}}:{data:{properties:{hashed_token:'one-time-test-token'}}};}}}};
 suppliedBearer=opts.global.headers.Authorization;
 return {auth:{getUser:async()=>scenario.signedOut?{data:{},error:{message:'Expired'}}:{data:{user:{id:'tester',email:'tester@example.test'}}}},rpc:async name=>({data:name==='aero_is_manager'?!!scenario.manager:scenario.denied?null:'company',error:scenario.rpcError?{message:'Unavailable'}:null})};
};
vm.runInNewContext(stripTypeScriptTypes(source),{createClient,Response,Request,console,Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'service':k==='SUPABASE_URL'?'https://test.invalid':'public'},serve:fn=>{handler=fn;}}});
const run=(state,body={target:'staff'},method='POST')=>{
 scenario=state;return handler(new Request('https://test.invalid',{method,headers:{Authorization:'Bearer test-session','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
};
assert.equal((await run({},undefined,'OPTIONS')).status,200);
assert.equal((await run({},undefined,'GET')).status,405);
assert.equal((await run({signedOut:true})).status,401);
assert.equal((await run({denied:true})).status,403);
assert.equal((await run({rpcError:true})).status,403);
assert.equal((await run({}, {target:'manager'})).status,403);
assert.equal(mint,0,'Unapproved callers must never mint a sign-in token');
const ok=await run({manager:true},{target:'manager'});assert.equal(ok.status,200);assert.equal((await ok.json()).token_hash,'one-time-test-token');
assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal(suppliedBearer,'Bearer test-session');
const error=await run({mintError:true});assert.equal(error.status,500);assert.ok(!(await error.text()).includes('Internal secret'));
console.log('Attendance handoff checks passed: method, authentication, entitlement, manager permission, caller JWT, non-cacheable token and safe errors');
