// Actual HTTP synthetic backend and generated clients. Never contact production.
import path from 'node:path';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {expect} from 'playwright/test';
import {auditTree,auditText,forbidden} from '../staging/audit.mjs';
const origin=process.env.STAGING_TEST_URL||'http://localhost:4201';
let count=0;function ok(name,condition){assert.ok(condition,name);count++;console.log('PASS '+name);}
if(!process.env.STAGING_TEST_URL){auditTree(path.resolve(import.meta.dirname,'../staging/.vercel/output'));ok('generated artifacts contain no production endpoints/references',true);
 for(const value of [...forbidden,'https://new-production-project.supabase.co','sb_secret_this_is_not_a_real_key']){assert.throws(()=>auditText(value));count++;}
}
async function api(p,{body,key='staging-public-v1',token,headers={},method}={}){
 const response=await fetch(origin+'/_staging'+p,{method:method||(body?'POST':'GET'),headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {response,data:await response.json()};
}
const info=await api('/info');ok('backend is synthetic with outbound disabled',info.data.mode==='synthetic-preview'&&info.data.outbound==='disabled');
const accounts=(await api('/accounts')).data;assert.equal(accounts.length,7);
for(const name of ['rakesh','aashish','anil']){const a=accounts.find(a=>a.name===name);ok(name+' trial account is in tenant A',a&&a.company==='Synthetic 1');ok(name+' trial account signs in',(await api('/auth/v1/token?grant_type=password',{body:{email:a.email,password:a.password}})).response.status===200);}
const one=accounts.find(a=>a.name==='staff-a'),two=accounts.find(a=>a.name==='staff-b'),manager=accounts.find(a=>a.name==='manager-a');
async function login(a){const r=await api('/auth/v1/token?grant_type=password',{body:{email:a.email,password:a.password}});assert.equal(r.response.status,200);return r.data.access_token;}
const s1=await login(one),s2=await login(two),m1=await login(manager);
ok('non-staging API key rejected',(await api('/rest/v1/aero_profiles',{key:'sb_secret_not_a_real_key',token:s1})).response.status===401);
ok('unissued credential rejected',(await api('/rest/v1/aero_profiles',{token:'production-shaped-but-invalid'})).response.status===401);
ok('cross-origin API rejected',(await api('/info',{headers:{Origin:'https://forbidden.invalid'}})).response.status===403);
const profiles=(await api('/rest/v1/aero_profiles?select=*',{token:s1})).data;
ok('tenant A cannot read tenant B profiles',profiles.length>0&&profiles.every(p=>p.company_id.endsWith('000000000001')));
ok('tenant B cannot read tenant A shifts',(await api('/rest/v1/aero_shifts?select=*',{token:s2})).data.every(s=>s.company_id.endsWith('000000000002')));
ok('staff cannot use manager controls',(await api('/control/revoke',{token:s1,body:{user:two.id}})).response.status===403);
ok('manager cannot revoke another tenant',(await api('/control/revoke',{token:m1,body:{user:two.id}})).response.status===403);
const hand=(await api('/functions/v1/aero-access',{token:s1,body:{target:'staff'}})).data.token_hash;
ok('synthetic handoff issued',!!hand);
ok('handoff can be used once',(await api('/auth/v1/verify',{body:{type:'magiclink',token_hash:hand}})).response.status===200);
ok('used handoff rejected',(await api('/auth/v1/verify',{body:{type:'magiclink',token_hash:hand}})).response.status===403);
ok('staff cannot mint manager handoff',(await api('/functions/v1/aero-access',{token:s1,body:{target:'manager'}})).response.status===403);
ok('Storage forwarding disabled',(await api('/storage/v1/object/anything',{token:s1})).response.status===403);
ok('unknown functions cannot forward',(await api('/functions/v1/unknown',{token:s1,body:{}})).response.status===404);

const sites=(await api('/rest/v1/aero_worksites?select=*',{token:s1})).data;
let started=await api('/rest/v1/rpc/aero_clock_in',{token:s1,body:{p_worksite_id:sites[0].id,p_lat:null,p_lng:null,p_accuracy:null}});
ok('clock-in uses actual isolated SQL',started.response.status===200&&!!started.data.id);
const repeated=await api('/rest/v1/rpc/aero_clock_in',{token:s1,body:{p_worksite_id:sites[0].id,p_lat:null,p_lng:null,p_accuracy:null}});
ok('clock-in retry is idempotent',repeated.data.id===started.data.id);
ok('break start supported',(await api('/rest/v1/rpc/aero_start_break',{token:s1,body:{}})).response.status===200);
ok('break end supported',(await api('/rest/v1/rpc/aero_end_break',{token:s1,body:{}})).response.status===200);
ok('clock-out supported',(await api('/rest/v1/rpc/aero_clock_out',{token:s1,body:{p_lat:null,p_lng:null,p_note:'Synthetic clock workflow'}})).response.status===200);
const correction=await api('/rest/v1/rpc/aero_request_shift_correction',{token:s1,body:{p_shift_id:started.data.id,p_in:new Date(Date.now()-600000).toISOString(),p_out:new Date(Date.now()-60000).toISOString(),p_reason:'Synthetic acceptance'}});
ok('correction request supported',correction.response.status===200&&!!correction.data.id);
ok('other tenant cannot read correction',(await api('/rest/v1/aero_shift_corrections?select=*',{token:s2})).data.every(c=>c.id!==correction.data.id));
ok('manager approval supported',(await api('/rest/v1/rpc/aero_review_shift_correction',{token:m1,body:{p_id:correction.data.id,p_approve:true,p_note:'Synthetic decision'}})).response.status===200);
ok('approval audited',(await api('/rest/v1/aero_audit_events?select=*',{token:m1})).data.some(a=>a.action==='approved'));

const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});
try{
 for(const width of [360,390,430,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',timezoneId:'Europe/London'});const external=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/attendance/?pilot=1');await page.locator('#email').fill(one.email);await page.locator('#pw').fill(one.password);await page.locator('#signin').click();
  await expect(page.locator('#app')).toBeVisible({timeout:20000});ok('real staff page signs into synthetic tenant '+width,true);
  ok('no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const rejected=await page.evaluate(async()=>{
   const targets=['https://oioqjfrlwrjovnouhusp.supabase.co/rest/v1/companies','https://ljrzcrphuepqtfrayeid.supabase.co/auth/v1/user','https://1b2139c185037dcd7e0328869b8b6fcf.r2.cloudflarestorage.com/anything','https://parking-ops.vercel.app/api/test'];
   const values=await Promise.all(targets.map(async u=>{try{await fetch(u);return false;}catch{return true;}}));
   for(const [u,k] of [[targets[0],'staging-public-v1'],[window.STAGING_CONFIG.apiBase,'sb_secret_not_real']])try{window.supabase.createClient(u,k);values.push(false);}catch{values.push(true);}
   try{new WebSocket('wss://oioqjfrlwrjovnouhusp.supabase.co/realtime/v1/websocket');values.push(false);}catch{values.push(true);}return values;
  });ok('production destinations/credentials blocked before requests '+width,rejected.every(Boolean)&&external.length===0);
  await page.goto(origin+'/attendance/manager?pilot=1');await page.locator('#email').fill(manager.email);await page.locator('#pw').fill(manager.password);await page.locator('#signin').click();await expect(page.locator('#app')).toBeVisible({timeout:20000});ok('manager signs in '+width,true);
  await page.locator('[data-tab=sheets]').click();await page.locator('#from').fill('2026-03-01');await page.locator('#to').fill('2026-11-01');await page.locator('#run').click();await expect(page.locator('#csv')).toBeEnabled({timeout:20000});
  ok('timesheets render '+width,await page.locator('#sheetBody tr').count()>0);ok('no page errors '+width,errors.length===0);

  await page.goto(origin+'/#t='+one.link);await page.locator('#pin').fill(one.pin);await expect(page.locator('#app')).toBeVisible({timeout:20000});
  ok('Parking signs into synthetic staff '+width,true);
  await page.locator('#menuBtn').click();await page.locator('#menuBody [data-view=me]').click();await page.locator('[data-attendance=staff]').click();
  await expect(page).toHaveURL(/attendance/);await expect(page.locator('#app')).toBeVisible({timeout:20000});
  ok('Parking hands off to isolated Attendance '+width,true);
  await context.close();
 }
}finally{await browser.close();}
console.log(count+' staging HTTP/isolation/browser checks passed');
