// Part 123 in a disposable PGlite database: the Call pop-ups permission, the "Incoming calls" alert switch,
// who is pushed (call_alert_staff) and the trigger that tells send-alerts. No live data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite(), id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const q=async(s,a=[])=>(await db.query(s,a)).rows, scalar=async(s,a=[])=>Object.values((await q(s,a))[0])[0];
const as=n=>q('update cur set staff_id=$1',[id(n)]);
let count=0; const test=async(n,f)=>{await f();console.log('PASS '+n);count++};
const co=id(1), co2=id(2);
await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema net;
create table net_posts(url text,body jsonb);
create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds int) returns int language sql as $$insert into net_posts values(url,body);select 1$$;
create table private.alert_config(id boolean primary key default true,function_url text);insert into private.alert_config(function_url) values('https://x/send-alerts');
create table companies(id uuid primary key,name text,brand jsonb default '{"calls":true}',calls jsonb default '{"on":true}');
create table staff(id uuid primary key,company_id uuid,name text,role text,active boolean default true,extra text[] default '{}');
create table cur(staff_id uuid);insert into cur values(null);
create function me() returns staff language sql stable security definer as $$select s.* from staff s join cur on cur.staff_id=s.id where active$$;
create function staff_target(u uuid) returns staff language sql as $$select * from staff where id=u$$;
create function private.collections_on(c uuid) returns boolean language sql as $$select true$$;
create function private.calls_on(c uuid) returns boolean language sql as $$select coalesce((select (calls->>'on')::boolean from companies where id=c) and (select (brand->>'calls')::boolean from companies where id=c),false)$$;
create function private.access_words(p text[]) returns text language sql as $$select array_to_string(p,',')$$;
create table activity(id bigint generated always as identity,company_id uuid,staff_id uuid,staff_name text,action text,value text);
create table alert_prefs(staff_id uuid primary key,company_id uuid,drops boolean default true,picks boolean default true,flights boolean default true,updated_at timestamptz default now());
create table customer_calls(id bigint generated always as identity primary key,company_id uuid,from_number text,status text default 'ringing');`);
await db.exec(`insert into companies(id,name) values('${co}','A'),('${co2}','B');
insert into staff(id,company_id,name,role,extra) values
 ('${id(11)}','${co}','owner','owner','{}'),('${id(12)}','${co}','manager','manager','{}'),('${id(13)}','${co}','office','office','{}'),
 ('${id(14)}','${co}','driver','bongo','{}'),('${id(15)}','${co}','driver+','bongo','{callpop}'),('${id(16)}','${co}','office-','office','{-callpop}'),
 ('${id(17)}','${co}','terminal','terminal','{}'),('${id(21)}','${co2}','other','owner','{}');
insert into staff(id,company_id,name,role,active) values('${id(18)}','${co}','off','office',false);`);
const sql=fs.readFileSync(new URL('../setup/123-call-popups.sql',import.meta.url),'utf8');
await test('Part 123 applies twice',async()=>{await db.exec(sql);await db.exec(sql)});
const can=async(n,a)=>{await as(n);return scalar('select can($1)',[a])};
await test('Call pop-ups: owner, manager, office by default; drivers and terminal not; per-person grant and refusal',async()=>{
  assert.equal(await can(11,'callpop'),true);assert.equal(await can(12,'callpop'),true);assert.equal(await can(13,'callpop'),true);
  assert.equal(await can(14,'callpop'),false);assert.equal(await can(17,'callpop'),false);
  assert.equal(await can(15,'callpop'),true);assert.equal(await can(16,'callpop'),false);
});
await test('CALLED no longer carries the pop-up: a driver with CALLED has no pop-up',async()=>{
  await q("update staff set extra='{called}' where id=$1",[id(14)]);
  assert.equal(await can(14,'called'),true);assert.equal(await can(14,'callpop'),false);
  await q("update staff set extra='{}' where id=$1",[id(14)]);
});
await test('my_permissions returns callpop; set_staff_access accepts it and rejects typos',async()=>{
  await as(11);assert.equal((await scalar('select my_permissions()')).callpop,true);
  await scalar('select (set_staff_access($1,$2::text[])).id',[id(14),['callpop']]);
  assert.equal(await can(14,'callpop'),true);
  await assert.rejects(()=>scalar('select (set_staff_access($1,$2::text[])).id',[id(14),['callpops']]),/Unknown permission/);
  await q("update staff set extra='{}' where id=$1",[id(14)]);
});
await test('call_alert_staff: pop-up people in this company, active, switch not off',async()=>{
  const ids=async()=>(await scalar('select call_alert_staff($1)',[co])).sort();
  assert.deepEqual(await ids(),[id(11),id(12),id(13),id(15)].sort());
  await as(13);await q('select set_call_alerts(false)');
  assert.deepEqual(await ids(),[id(11),id(12),id(15)].sort());
  await q('select set_call_alerts(true)');
  assert.equal(await scalar('select count(*)::int from alert_prefs where staff_id=$1 and calls',[id(13)]),1);
});
await test('Calls add-on off: nobody is pushed',async()=>{
  await q(`update companies set brand='{}' where id='${co}'`);
  assert.deepEqual(await scalar('select call_alert_staff($1)',[co]),[]);
  await q(`update companies set brand='{"calls":true}' where id='${co}'`);
});
await test('A new ringing call tells send-alerts once; other statuses do not',async()=>{
  await q('delete from net_posts');
  await q("insert into customer_calls(company_id,from_number) values($1,'07700900001')",[co]);
  await q("insert into customer_calls(company_id,from_number,status) values($1,'07700900002','missed')",[co]);
  const r=await q('select body from net_posts');
  assert.equal(r.length,1);assert.equal(r[0].body.type,'call');
});
await test('A failing alert never blocks the call',async()=>{
  await q('update private.alert_config set function_url=null');
  await q("insert into customer_calls(company_id,from_number) values($1,'07700900003')",[co]);
  await q("update private.alert_config set function_url='https://x/send-alerts'");
});
await test('Private functions are not open to app logins',async()=>{
  for(const r of ['anon','authenticated']) assert.equal(await scalar("select has_function_privilege($1,'call_alert_staff(uuid)','execute')",[r]),false);
  assert.equal(await scalar("select has_function_privilege('service_role','call_alert_staff(uuid)','execute')"),true);
});
await db.close();console.log(`${count} passed`);
